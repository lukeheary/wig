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

export function formatFriendRsvpBody({
  eventTitle,
  eventStartAt,
  eventTimeZone,
  eventState,
  status,
  includesPartner,
}: {
  eventTitle: string;
  eventStartAt: Date | null;
  eventTimeZone?: string | null;
  eventState?: string | null;
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
  const dateSuffix = eventStartAt
    ? ` on ${formatNotificationEventDate(
        eventStartAt,
        eventTimeZone,
        eventState
      )}`
    : "";

  return `${verb} ${eventTitle}${dateSuffix}`;
}
