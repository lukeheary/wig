import { eventTimeZone, formatEventDate } from "@/lib/utils";

export function formatNotificationEventDate(
  eventStartAt: Date,
  timeZone?: string | null,
  state?: string | null
) {
  return formatEventDate(eventStartAt, timeZone, state, {
    month: "short",
    day: "numeric",
  });
}

// Keep these rules aligned with ActivityEventDateFormatting in the iOS app.
export function formatNotificationEventDatePhrase(
  eventStartAt: Date,
  timeZone?: string | null,
  state?: string | null,
  now = new Date()
) {
  const resolvedTimeZone = eventTimeZone(timeZone, state);
  const parts = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: resolvedTimeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(date);
  const eventParts = parts(eventStartAt);
  const value = (items: Intl.DateTimeFormatPart[], type: string) =>
    Number(items.find((part) => part.type === type)?.value);
  const dayNumber = (items: Intl.DateTimeFormatPart[]) =>
    Date.UTC(
      value(items, "year"),
      value(items, "month") - 1,
      value(items, "day")
    ) / 86_400_000;
  // Compare local calendar days, rather than elapsed hours, across DST changes.
  const daysAway = dayNumber(eventParts) - dayNumber(parts(now));
  const isEvening = value(eventParts, "hour") >= 17;
  if (daysAway === 0) return isEvening ? "tonight" : "today";
  if (daysAway === 1) return isEvening ? "tomorrow night" : "tomorrow";
  if (daysAway >= 2 && daysAway <= 6) {
    return `this ${formatEventDate(eventStartAt, timeZone, state, { weekday: "long" })}`;
  }
  return `on ${formatNotificationEventDate(eventStartAt, timeZone, state)}`;
}

export function formatNotificationEventDetails({
  eventTitle,
  eventPlaceName,
  eventStartAt,
  eventTimeZone,
  eventState,
  now,
}: {
  eventTitle: string;
  eventPlaceName?: string | null;
  eventStartAt: Date | null;
  eventTimeZone?: string | null;
  eventState?: string | null;
  now?: Date;
}) {
  const placeName = eventPlaceName?.trim();
  const placeSuffix = placeName ? ` at ${placeName}` : "";
  const dateSuffix = eventStartAt
    ? ` ${formatNotificationEventDatePhrase(eventStartAt, eventTimeZone, eventState, now)}`
    : "";

  return `${eventTitle}${placeSuffix}${dateSuffix}`;
}

export function formatFriendRsvpBody({
  eventTitle,
  eventStartAt,
  eventPlaceName,
  eventTimeZone,
  eventState,
  status,
  includesPartner,
  now,
}: {
  eventTitle: string;
  eventStartAt: Date | null;
  eventTimeZone?: string | null;
  eventState?: string | null;
  eventPlaceName?: string | null;
  status: "going" | "interested";
  includesPartner: boolean;
  now?: Date;
}) {
  const verb = includesPartner
    ? status === "going"
      ? "Are going to"
      : "Are interested in"
    : status === "going"
      ? "Is going to"
      : "Is interested in";
  return `${verb} ${formatNotificationEventDetails({
    eventTitle,
    eventPlaceName,
    eventStartAt,
    eventTimeZone,
    eventState,
    now,
  })}`;
}
