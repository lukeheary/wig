import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { userFriends, userPartners, users } from "@/server/db/schema";
import { createNotification } from "@/server/utils/notifications";
import { sendPushNotificationToUsers } from "@/server/utils/push-notifications";
import { usersAreBlocked } from "@/server/utils/user-blocks";

const bodySchema = z.object({
  recipientId: z.string(),
});

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

export async function POST(request: Request) {
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid partner request payload" },
      { status: 400 }
    );
  }

  const { recipientId } = parsed.data;

  if (recipientId === userId) {
    return NextResponse.json(
      { error: "Cannot send a partner request to yourself" },
      { status: 400 }
    );
  }

  const recipientUser = await db.query.users.findFirst({
    where: eq(users.id, recipientId),
  });

  if (!recipientUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (await usersAreBlocked(userId, recipientId)) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const friendship = await db.query.userFriends.findFirst({
    where: and(
      or(
        and(
          eq(userFriends.userId, userId),
          eq(userFriends.friendUserId, recipientId)
        ),
        and(
          eq(userFriends.userId, recipientId),
          eq(userFriends.friendUserId, userId)
        )
      ),
      eq(userFriends.status, "accepted")
    ),
  });

  if (!friendship) {
    return NextResponse.json(
      { error: "You can only send partner requests to accepted friends" },
      { status: 400 }
    );
  }

  const existingRelationships = await db.query.userPartners.findMany({
    where: or(
      eq(userPartners.requesterId, userId),
      eq(userPartners.recipientId, userId),
      eq(userPartners.requesterId, recipientId),
      eq(userPartners.recipientId, recipientId)
    ),
  });

  const existingBetweenUsers = existingRelationships.find(
    (relationship) =>
      (relationship.requesterId === userId &&
        relationship.recipientId === recipientId) ||
      (relationship.requesterId === recipientId &&
        relationship.recipientId === userId)
  );

  if (existingBetweenUsers) {
    const message =
      existingBetweenUsers.status === "accepted"
        ? "You are already partners"
        : existingBetweenUsers.requesterId === userId
          ? "Partner request already sent"
          : "This user already sent you a partner request";

    return NextResponse.json({ error: message }, { status: 409 });
  }

  const currentUserHasPartner = existingRelationships.some(
    (relationship) =>
      relationship.requesterId === userId || relationship.recipientId === userId
  );
  if (currentUserHasPartner) {
    return NextResponse.json(
      { error: "You already have a partner relationship" },
      { status: 409 }
    );
  }

  const recipientHasPartner = existingRelationships.some(
    (relationship) =>
      relationship.requesterId === recipientId ||
      relationship.recipientId === recipientId
  );
  if (recipientHasPartner) {
    return NextResponse.json(
      { error: "This user already has a partner relationship" },
      { status: 409 }
    );
  }

  const [partnerRequest] = await db
    .insert(userPartners)
    .values({
      requesterId: userId,
      recipientId,
      status: "pending",
    })
    .returning();

  const currentUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      firstName: true,
      lastName: true,
      username: true,
    },
  });

  const senderName =
    [currentUser?.firstName, currentUser?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    currentUser?.username ||
    "Someone";

  await createNotification(
    {
      userId: recipientId,
      actorUserId: userId,
      type: "partner_request",
      entityType: "partner_request",
      entityId: partnerRequest.id,
      title: senderName,
      body: "Sent you a partner request",
      metadata: {
        requestId: partnerRequest.id,
        requestType: "partner",
      },
    },
    db
  );

  await sendPushNotificationToUsers([recipientId], {
    title: senderName,
    body: "Sent you a partner request",
    data: {
      type: "partner_request",
      entityId: partnerRequest.id,
      actionUrl: "/profile",
    },
  });

  return NextResponse.json({});
}
