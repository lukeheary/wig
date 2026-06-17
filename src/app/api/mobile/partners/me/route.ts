import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { userPartners, users } from "@/server/db/schema";

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

export async function GET() {
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({ relationship: null });
  }

  const relationship = await db.query.userPartners.findFirst({
    where: or(
      eq(userPartners.requesterId, userId),
      eq(userPartners.recipientId, userId)
    ),
    with: {
      requester: true,
      recipient: true,
    },
  });

  if (!relationship) {
    return NextResponse.json({ relationship: null });
  }

  const partner =
    relationship.requesterId === userId
      ? relationship.recipient
      : relationship.requester;

  return NextResponse.json({
    relationship: {
      id: relationship.id,
      status: relationship.status,
      isRequester: relationship.requesterId === userId,
      partner: {
        id: partner.id,
        firstName: partner.firstName,
        lastName: partner.lastName,
        username: partner.username,
        avatarImageUrl: partner.avatarImageUrl,
      },
    },
  });
}

export async function DELETE() {
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existingRelationship = await db.query.userPartners.findFirst({
    where: and(
      or(eq(userPartners.requesterId, userId), eq(userPartners.recipientId, userId)),
      eq(userPartners.status, "accepted")
    ),
  });

  if (!existingRelationship) {
    return NextResponse.json({});
  }

  await db.delete(userPartners).where(eq(userPartners.id, existingRelationship.id));

  return NextResponse.json({});
}
