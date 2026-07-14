import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { eventReviews, eventRsvps, events } from "@/server/db/schema";
import { eventTimeZone } from "@/lib/utils";

const paramsSchema = z.object({ id: z.string().uuid() });

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

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = paramsSchema.parse(await context.params);
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    return NextResponse.json({ error: "Only attendees can skip this review" }, { status: 403 });
  }

  await db
    .insert(eventReviews)
    .values({ userId, eventId, rating: null, comment: null, skippedAt: new Date() })
    .onConflictDoNothing({
      target: [eventReviews.userId, eventReviews.eventId],
    });

  return NextResponse.json({});
}
