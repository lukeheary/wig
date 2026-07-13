import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { eventReviews, eventRsvps, events, users } from "@/server/db/schema";

const paramsSchema = z.object({ id: z.string().uuid() });
const reviewSchema = z.object({
  rating: z.enum(["loved_it", "liked_it", "okay", "did_not_like_it"]),
  comment: z.string().trim().max(2_000).nullable().optional(),
});

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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = paramsSchema.parse(await context.params);
  const userId = await currentMobileUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = reviewSchema.parse(await request.json());
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
    columns: { id: true, endAt: true },
  });

  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (!event.endAt || event.endAt > new Date()) {
    return NextResponse.json({ error: "Reviews open after the event ends" }, { status: 400 });
  }

  const rsvp = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.userId, userId), eq(eventRsvps.eventId, eventId)),
    columns: { status: true },
  });
  if (rsvp?.status !== "going") {
    return NextResponse.json({ error: "Only attendees can review this event" }, { status: 403 });
  }

  const comment = body.comment || null;
  const [review] = await db
    .insert(eventReviews)
    .values({ userId, eventId, rating: body.rating, comment })
    .onConflictDoUpdate({
      target: [eventReviews.userId, eventReviews.eventId],
      set: { rating: body.rating, comment, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json(review);
}
