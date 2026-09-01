import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { userFriends, userPromotedEvents, users } from "@/server/db/schema";

const paramsSchema = z.object({ id: z.string().uuid() });

async function currentMobileUserId() {
  const { userId } = await auth();
  if (userId) return userId;

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: { id: true },
  });
  return previewUser?.id ?? null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = paramsSchema.parse(await context.params);
  const userId = await currentMobileUserId();
  if (!userId) return NextResponse.json({ promotions: [] });

  const friendships = await db.query.userFriends.findMany({
    where: and(
      or(eq(userFriends.userId, userId), eq(userFriends.friendUserId, userId)),
      eq(userFriends.status, "accepted")
    ),
    columns: { userId: true, friendUserId: true },
  });
  const friendIds = friendships.map((friendship) =>
    friendship.userId === userId
      ? friendship.friendUserId
      : friendship.userId
  );

  if (friendIds.length === 0) {
    return NextResponse.json({ promotions: [] });
  }

  const promotions = await db.query.userPromotedEvents.findMany({
    where: and(
      eq(userPromotedEvents.eventId, eventId),
      inArray(userPromotedEvents.userId, friendIds)
    ),
    with: { user: true },
    orderBy: [asc(userPromotedEvents.createdAt)],
  });

  return NextResponse.json({
    promotions: promotions.flatMap(({ user, promo, promoUrl }) =>
      user
        ? [{
            userId: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
            avatarImageUrl: user.avatarImageUrl,
            promo,
            promoUrl,
          }]
        : []
    ),
  });
}
