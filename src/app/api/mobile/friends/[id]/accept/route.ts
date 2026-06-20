import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { userFriends, users } from "@/server/db/schema";
import {
  createNotification,
  deleteNotificationsForEntity,
} from "@/server/utils/notifications";
import { sendPushNotificationToUsers } from "@/server/utils/push-notifications";

async function currentMobileUserId() {
  const { userId } = await auth();

  if (userId) {
    return userId;
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: { id: true },
  });

  return previewUser?.id ?? null;
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function resolvePendingFriendRequest(id: string, userId: string) {
  const directMatch = await db.query.userFriends.findFirst({
    where: eq(userFriends.id, id),
  });

  if (directMatch) {
    return directMatch;
  }

  return db.query.userFriends.findFirst({
    where: and(
      eq(userFriends.status, "pending"),
      eq(userFriends.friendUserId, userId),
      or(eq(userFriends.userId, id), eq(userFriends.friendUserId, id))
    ),
  });
}

export async function POST(_: Request, context: RouteContext) {
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const friendRequest = await resolvePendingFriendRequest(id, userId);

  if (!friendRequest) {
    return NextResponse.json({ error: "Friend request not found" }, { status: 404 });
  }

  if (friendRequest.friendUserId !== userId) {
    return NextResponse.json(
      { error: "You can only accept requests sent to you" },
      { status: 403 }
    );
  }

  if (friendRequest.status !== "pending") {
    return NextResponse.json(
      { error: "This request has already been processed" },
      { status: 400 }
    );
  }

  await db
    .update(userFriends)
    .set({
      status: "accepted",
      updatedAt: new Date(),
    })
    .where(eq(userFriends.id, friendRequest.id));

  await deleteNotificationsForEntity(
    {
      userId,
      entityType: "friend_request",
      entityIds: [friendRequest.id],
    },
    db
  );

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      firstName: true,
      lastName: true,
      username: true,
    },
  });

  const accepterName =
    [currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(" ").trim() ||
    currentUser?.username ||
    "Someone";

  await createNotification(
    {
      userId: friendRequest.userId,
      actorUserId: userId,
      type: "friend_request_accepted",
      entityType: "friend_request",
      entityId: friendRequest.id,
      title: accepterName,
      body: "Added you as a friend",
      actionUrl: "/friends/list",
      metadata: {
        requestId: friendRequest.id,
        requestType: "friend",
      },
    },
    db
  );

  await sendPushNotificationToUsers([friendRequest.userId], {
    title: accepterName,
    body: "Added you as a friend",
    data: {
      type: "friend_request_accepted",
      entityId: friendRequest.id,
      actionUrl: "/friends/list",
    },
  });

  return NextResponse.json({});
}
