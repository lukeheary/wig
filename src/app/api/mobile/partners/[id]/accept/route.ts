import { auth } from "@clerk/nextjs/server";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { userPartners, users } from "@/server/db/schema";
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
    columns: {
      id: true,
    },
  });

  return previewUser?.id ?? null;
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const partnerRequest = await db.query.userPartners.findFirst({
    where: eq(userPartners.id, id),
  });

  if (!partnerRequest) {
    return NextResponse.json({ error: "Partner request not found" }, { status: 404 });
  }

  if (partnerRequest.recipientId !== userId) {
    return NextResponse.json(
      { error: "You can only accept partner requests sent to you" },
      { status: 403 }
    );
  }

  if (partnerRequest.status !== "pending") {
    return NextResponse.json(
      { error: "This partner request has already been processed" },
      { status: 400 }
    );
  }

  await db
    .update(userPartners)
    .set({
      status: "accepted",
      updatedAt: new Date(),
    })
    .where(eq(userPartners.id, id));

  await deleteNotificationsForEntity(
    {
      userId,
      entityType: "partner_request",
      entityIds: [id],
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
      userId: partnerRequest.requesterId,
      actorUserId: userId,
      type: "partner_request_accepted",
      entityType: "partner_request",
      entityId: id,
      title: "Partner Request Accepted",
      body: `${accepterName} is now your partner`,
      actionUrl: "/profile",
      metadata: {
        requestId: id,
        requestType: "partner",
      },
    },
    db
  );

  await sendPushNotificationToUsers([partnerRequest.requesterId], {
    title: "Partner Request Accepted",
    body: `${accepterName} is now your partner`,
    data: {
      type: "partner_request_accepted",
      entityId: id,
      actionUrl: "/profile",
    },
  });

  return NextResponse.json({});
}
