import { sql, type AnyColumn } from "drizzle-orm";
import { events } from "@/server/db/schema";

export const EVENT_SOURCES = [
  "ticketmaster",
  "eventbrite",
  "posh",
  "dice",
] as const;

/** Shared discovery rule. Null sources (events authored in Wig) remain visible. */
export function visibleEventSourceCondition() {
  return sql`not exists (
    select 1 from event_source_visibility source_visibility
    where source_visibility.source = ${events.source}
      and source_visibility.hidden = true
  )`;
}

/** Apply the rule to rows that reference an event, such as RSVPs and activity. */
export function visibleEventIdCondition(eventId: AnyColumn) {
  return sql`${eventId} in (
    select id from events visible_events
    where not exists (
      select 1 from event_source_visibility source_visibility
      where source_visibility.source = visible_events.source
        and source_visibility.hidden = true
    )
  )`;
}
