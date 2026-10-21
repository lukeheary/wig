import { withVisibleProfiles } from "@/server/utils/profile-visibility";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { eventRsvps } from "@/server/db/schema";

/** Aggregate-only social proof that is safe to return to signed-out clients. */
export async function goingRsvpCountsForEventIds(eventIds: string[]) {
  if (eventIds.length === 0) {
    return new Map<string, number>();
  }

  const rows = await db
    .select({
      eventId: eventRsvps.eventId,
      count: sql<number>`count(*)::int`,
    })
    .from(eventRsvps)
    .where(await withVisibleProfiles(and(
        inArray(eventRsvps.eventId, eventIds),
        eq(eventRsvps.status, "going")
      ), eventRsvps.userId))
    .groupBy(eventRsvps.eventId);

  return new Map(rows.map((row) => [row.eventId, row.count]));
}
