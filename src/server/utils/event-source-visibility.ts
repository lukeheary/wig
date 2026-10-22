import { auth } from "@clerk/nextjs/server";
import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { events } from "@/server/db/schema";

export const EVENT_SOURCES = [
  "ticketmaster",
  "eventbrite",
  "posh",
  "dice",
] as const;

/** Global rules apply to everyone; account preferences additionally hide sources. */
export function eventSourceVisibilityCondition(
  source: AnyColumn | SQL,
  viewerId: string | null | AnyColumn | SQL
) {
  return sql`not exists (
    select 1 from event_source_visibility source_visibility
    where source_visibility.source = ${source} and source_visibility.hidden = true
  ) and not exists (
    select 1 from user_event_source_visibility account_visibility
    where account_visibility.user_id = ${viewerId}
      and account_visibility.source = ${source} and account_visibility.hidden = true
  )`;
}

/** Use authenticated request identity, never a user ID supplied by the client. */
export async function visibleEventSourceCondition() {
  const { userId } = await auth();
  return eventSourceVisibilityCondition(events.source, userId);
}

/** Apply the same viewer rule to RSVP and activity references. */
export async function visibleEventIdCondition(
  eventId: AnyColumn,
  textReference = false
) {
  const { userId } = await auth();
  return sql`${eventId} in (
    select ${textReference ? sql`id::text` : sql`id`} from events visible_events
    where ${eventSourceVisibilityCondition(sql`visible_events.source`, userId)}
  )`;
}
