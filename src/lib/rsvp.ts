export const RSVP_DECLINE_REASON_VALUES = [
  "busy",
  "out_of_town",
  "working",
  "laying_low",
] as const;

export type RsvpDeclineReason = (typeof RSVP_DECLINE_REASON_VALUES)[number];

export const RSVP_DECLINE_REASON_LABELS: Record<RsvpDeclineReason, string> = {
  busy: "Busy",
  out_of_town: "Out of town",
  working: "Working",
  laying_low: "Laying low",
};

export function getRsvpDeclineReasonPhrase(reason: RsvpDeclineReason): string {
  switch (reason) {
    case "busy":
      return "busy";
    case "out_of_town":
      return "out of town";
    case "working":
      return "working";
    case "laying_low":
      return "laying low";
  }
}
