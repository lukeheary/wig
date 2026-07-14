import { auth } from "@clerk/nextjs/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import {
  eventReviews,
  eventRsvps,
  events,
} from "@/server/db/schema";
import { eventTimeZone } from "@/lib/utils";

const paramsSchema = z.object({ id: z.string().uuid() });
const reviewSchema = z.object({
  rating: z.enum(["loved_it", "liked_it", "okay", "did_not_like_it"]),
  comment: z.string().trim().max(2_000).nullable().optional(),
});

async function currentMobileUserId() {
  const { userId } = await auth();
  return userId;
}

function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function isEligibleForReview(
  event: { startAt: Date; endAt: Date | null; timeZone: string | null; state: string },
  now: Date
) {
  if (event.endAt) return event.endAt <= now;

  const timeZone = eventTimeZone(event.timeZone, event.state) ?? "America/New_York";
  return localDateKey(event.startAt, timeZone) < localDateKey(now, timeZone);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = paramsSchema.parse(await context.params);
  const userId = await currentMobileUserId();
  if (!userId) return NextResponse.json({ review: null });

  const review = await db.query.eventReviews.findFirst({
    where: and(
      eq(eventReviews.userId, userId),
      eq(eventReviews.eventId, eventId),
      isNotNull(eventReviews.rating)
    ),
  });

  return NextResponse.json({ review: review ?? null });
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
    columns: { id: true, startAt: true, endAt: true, timeZone: true, state: true },
  });

  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (!isEligibleForReview(event, new Date())) {
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
      set: { rating: body.rating, comment, skippedAt: null, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json(review);
}
