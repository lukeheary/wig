import { formatEventDate } from "@/lib/utils";

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

export function formatNotificationEventDetails({
  eventTitle,
  eventPlaceName,
  eventStartAt,
  eventTimeZone,
  eventState,
}: {
  eventTitle: string;
  eventPlaceName?: string | null;
  eventStartAt: Date | null;
  eventTimeZone?: string | null;
  eventState?: string | null;
}) {
  const placeName = eventPlaceName?.trim();
  const placeSuffix = placeName ? ` at ${placeName}` : "";
  const dateSuffix = eventStartAt
    ? ` on ${formatNotificationEventDate(eventStartAt, eventTimeZone, eventState)}`
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
}: {
  eventTitle: string;
  eventStartAt: Date | null;
  eventTimeZone?: string | null;
  eventState?: string | null;
  eventPlaceName?: string | null;
  status: "going" | "interested";
  includesPartner: boolean;
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
  })}`;
}
