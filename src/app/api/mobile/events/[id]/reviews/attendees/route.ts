import { withVisibleProfiles } from "@/server/utils/profile-visibility";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { eventReviews, users } from "@/server/db/schema";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = paramsSchema.parse(await context.params);
  const { userId: clerkUserId } = await auth();
  const userId = clerkUserId ?? (
    await db.query.users.findFirst({
      where: eq(users.isOnboarding, false),
      orderBy: [asc(users.createdAt)],
      columns: { id: true },
    })
  )?.id;

  if (!userId) {
    return NextResponse.json({ reviews: [] });
  }

  const reviews = await db.query.eventReviews.findMany({
    where: await withVisibleProfiles(and(
      eq(eventReviews.eventId, eventId),
      isNotNull(eventReviews.rating)
    ), eventReviews.userId),
    columns: {
      userId: true,
      rating: true,
    },
  });

  return NextResponse.json({ reviews });
}
