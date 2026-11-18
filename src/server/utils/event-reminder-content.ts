import { eventTimeZone } from "@/lib/utils";
import { formatNotificationEventDatePhrase } from "./notification-content";

export type ReminderEvent = {
  title: string;
  startAt: Date;
  timeZone: string | null;
  state: string;
  placeName?: string | null;
};

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

export function reminderTimeZone(
  event: Pick<ReminderEvent, "timeZone" | "state">
) {
  // Never let the server's local time zone decide a reminder's delivery time.
  const zone = eventTimeZone(event.timeZone, event.state) ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return eventTimeZone(null, event.state) ?? "UTC";
  }
}

export function eventReminderScheduledAt(event: ReminderEvent): Date {
  const timeZone = reminderTimeZone(event);
  const parts = localParts(event.startAt, timeZone);
  const evening = parts.hour >= 17;
  // Calendar arithmetic, rather than subtracting 24 hours, preserves local time
  // when daylight saving time changes between the reminder and the event.
  const target = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day - (evening ? 0 : 1),
    evening ? 13 : 20
  );
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const local = localParts(new Date(candidate), timeZone);
    const offset =
      Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second
      ) - candidate;
    const next = target - offset;
    if (candidate === next) break;
    candidate = next;
  }
  return new Date(candidate);
}

export function isEventReminderDue(event: ReminderEvent, now: Date) {
  const scheduledAt = eventReminderScheduledAt(event).getTime();
  // Allow delayed/retried cron runs for an hour, without sending stale alerts
  // after a long outage or once an event has started.
  return (
    event.startAt > now &&
    scheduledAt <= now.getTime() &&
    now.getTime() - scheduledAt < 60 * 60_000
  );
}

export function eventReminderContent(
  event: ReminderEvent,
  status: "going" | "interested",
  now: Date
) {
  const timeZone = reminderTimeZone(event);
  const phrase = formatNotificationEventDatePhrase(
    event.startAt,
    timeZone,
    event.state,
    now
  );
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(event.startAt)
    .replace(":00", "");
  const place = event.placeName?.trim();
  const when = `${phrase} at ${time}${place ? ` at ${place}` : ""}.`;
  return status === "going"
    ? { title: `Reminder: ${event.title}`, body: `You’re going ${when}` }
    : {
        title: `Still interested in ${event.title}?`,
        body: `It’s happening ${when}`,
      };
}
