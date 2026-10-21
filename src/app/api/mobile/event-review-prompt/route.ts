import { visibleEventIdCondition } from "@/server/utils/event-source-visibility";
import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { eventReviews, eventRsvps } from "@/server/db/schema";
import { eventTimeZone } from "@/lib/utils";

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

function isWithinHomeReviewWindow(
  event: { startAt: Date; endAt: Date | null; timeZone: string | null; state: string },
  now: Date
) {
  if (event.endAt) {
    return now.getTime() <= event.endAt.getTime() + 7 * 24 * 60 * 60 * 1_000;
  }

  // An event without an end time is treated as ending at midnight following
  // its local event day, so it remains eligible through the seventh day after.
  const timeZone = eventTimeZone(event.timeZone, event.state) ?? "America/New_York";
  const startDay = localDateKey(event.startAt, timeZone);
  const currentDay = localDateKey(now, timeZone);
  const elapsedCalendarDays = Math.round(
    (Date.parse(`${currentDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) /
      (24 * 60 * 60 * 1_000)
  );

  return elapsedCalendarDays < 8;
}

export async function GET() {
  const userId = await currentMobileUserId();
  if (!userId) return NextResponse.json({ event: null });

  const now = new Date();

  const rsvps = await db.query.eventRsvps.findMany({
    where: and(visibleEventIdCondition(eventRsvps.eventId), eq(eventRsvps.userId, userId), eq(eventRsvps.status, "going")),
    with: { event: { with: { venue: true } } },
  });

  const eligibleEvents = rsvps
    .map((rsvp) => rsvp.event)
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate) &&
      candidate.visibility === "public" &&
      candidate.status === "active" &&
      isEligibleForReview(candidate, now) &&
      isWithinHomeReviewWindow(candidate, now)
    );

  const eligibleEventIDs = eligibleEvents.map((event) => event.id);
  const reviewStates =
    eligibleEventIDs.length > 0
      ? await db.query.eventReviews.findMany({
          where: and(
            eq(eventReviews.userId, userId),
            inArray(eventReviews.eventId, eligibleEventIDs)
          ),
          columns: { eventId: true },
        })
      : [];
  const excludedEventIDs = new Set(reviewStates.map((review) => review.eventId));

  const event = eligibleEvents
    .filter((candidate) => !excludedEventIDs.has(candidate.id))
    .sort(
      (lhs, rhs) =>
        (rhs.endAt?.getTime() ?? rhs.startAt.getTime()) -
        (lhs.endAt?.getTime() ?? lhs.startAt.getTime())
    )
    .at(0);

  return NextResponse.json({
    event: event
      ? {
          id: event.id,
          publicId: event.publicId,
          title: event.title,
          coverImageUrl: event.coverImageUrl,
          startAt: event.startAt,
          endAt: event.endAt,
          venueName: event.venue?.name ?? null,
          city: event.city,
          state: event.state,
        }
      : null,
  });
}
