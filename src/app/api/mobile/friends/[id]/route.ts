import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import {
  userFriends,
  userFriendsMutedNotifications,
  users,
} from "@/server/db/schema";
import { deleteNotificationsForEntity } from "@/server/utils/notifications";

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
      or(eq(userFriends.userId, userId), eq(userFriends.friendUserId, userId)),
      or(
        and(eq(userFriends.friendUserId, userId), eq(userFriends.userId, id)),
        and(eq(userFriends.userId, userId), eq(userFriends.friendUserId, id))
      )
    ),
  });
}

export async function DELETE(_: Request, context: RouteContext) {
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const friendRequest = await resolvePendingFriendRequest(id, userId);

  if (!friendRequest) {
    return NextResponse.json(
      { error: "Friend request not found" },
      { status: 404 }
    );
  }

  if (
    friendRequest.friendUserId !== userId &&
    friendRequest.userId !== userId
  ) {
    return NextResponse.json(
      { error: "You cannot reject this request" },
      { status: 403 }
    );
  }

  const otherUserId =
    friendRequest.userId === userId
      ? friendRequest.friendUserId
      : friendRequest.userId;

  await db.delete(userFriends).where(eq(userFriends.id, friendRequest.id));

  await db
    .delete(userFriendsMutedNotifications)
    .where(
      or(
        and(
          eq(userFriendsMutedNotifications.userId, userId),
          eq(userFriendsMutedNotifications.friendUserId, otherUserId)
        ),
        and(
          eq(userFriendsMutedNotifications.userId, otherUserId),
          eq(userFriendsMutedNotifications.friendUserId, userId)
        )
      )
    );

  await deleteNotificationsForEntity(
    {
      entityType: "friend_request",
      entityIds: [friendRequest.id],
    },
    db
  );

  return NextResponse.json({});
}
