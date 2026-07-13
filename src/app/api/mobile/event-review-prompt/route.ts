import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { eventRsvps, users } from "@/server/db/schema";
import { eventTimeZone } from "@/lib/utils";

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

export async function GET() {
  const userId = await currentMobileUserId();
  if (!userId) return NextResponse.json({ event: null });

  const now = new Date();

  const rsvps = await db.query.eventRsvps.findMany({
    where: and(eq(eventRsvps.userId, userId), eq(eventRsvps.status, "going")),
    with: { event: { with: { venue: true } } },
  });

  const event = rsvps
    .map((rsvp) => rsvp.event)
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate) &&
      candidate.visibility === "public" &&
      candidate.status === "active" &&
      isEligibleForReview(candidate, now)
    )
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
