export const EVENT_STATUS_VALUES = [
  "active",
  "cancelled",
  "postponed",
  "draft",
] as const;

export type EventStatus = (typeof EVENT_STATUS_VALUES)[number];

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  active: "Active",
  cancelled: "Cancelled",
  postponed: "Postponed",
  draft: "Draft",
};

export const EVENT_STATUS_BADGE_CLASSNAMES: Record<EventStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
  postponed: "border-amber-200 bg-amber-50 text-amber-700",
  draft: "border-slate-200 bg-slate-100 text-slate-700",
};

export function getEventStatusLabel(status: EventStatus) {
  return EVENT_STATUS_LABELS[status];
}

export function getEventStatusBadgeClassName(status: EventStatus) {
  return EVENT_STATUS_BADGE_CLASSNAMES[status];
}
