import { auth } from "@clerk/nextjs/server";
import { asc, eq, or } from "drizzle-orm";
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
