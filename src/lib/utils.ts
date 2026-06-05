import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, differenceInCalendarDays, startOfDay } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date): string {
  return format(date, "MMM d, yyyy");
}

export function formatTime(date: Date): string {
  return format(date, "h:mm a");
}

export function eventTimeZone(
  timeZone?: string | null,
  state?: string | null
): string | undefined {
  if (timeZone) return timeZone;

  switch (state?.toUpperCase()) {
    case "CT":
    case "DC":
    case "DE":
    case "FL":
    case "GA":
    case "IN":
    case "KY":
    case "MA":
    case "MD":
    case "ME":
    case "MI":
    case "NC":
    case "NH":
    case "NJ":
    case "NY":
    case "OH":
    case "PA":
    case "RI":
    case "SC":
    case "TN":
    case "VA":
    case "VT":
    case "WV":
      return "America/New_York";
    case "AL":
    case "AR":
    case "IA":
    case "IL":
    case "KS":
    case "LA":
    case "MN":
    case "MO":
    case "MS":
    case "ND":
    case "NE":
    case "OK":
    case "SD":
    case "TX":
    case "WI":
      return "America/Chicago";
    case "AZ":
    case "CO":
    case "ID":
    case "MT":
    case "NM":
    case "UT":
    case "WY":
      return "America/Denver";
    case "CA":
    case "NV":
    case "OR":
    case "WA":
      return "America/Los_Angeles";
    case "AK":
      return "America/Anchorage";
    case "HI":
      return "Pacific/Honolulu";
    default:
      return undefined;
  }
}

export function formatEventTime(
  date: Date | string,
  timeZone?: string | null,
  state?: string | null
): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: eventTimeZone(timeZone, state),
  }).format(new Date(date));
}

export function formatEventDate(
  date: Date | string,
  timeZone?: string | null,
  state?: string | null,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  }
): string {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: eventTimeZone(timeZone, state),
  }).format(new Date(date));
}

export function formatEventDateKey(
  date: Date | string,
  timeZone?: string | null,
  state?: string | null
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: eventTimeZone(timeZone, state),
  }).formatToParts(new Date(date));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function formatDateTime(date: Date): string {
  return format(date, "MMM d, yyyy 'at' h:mm a");
}

export function formatRelativeEventDate(date: Date): string {
  const now = startOfDay(new Date());
  const eventDate = startOfDay(date);
  const diff = differenceInCalendarDays(eventDate, now);

  if (diff === 0) return "tonight";
  if (diff === 1) return "tomorrow";
  if (diff > 1 && diff < 7) return `on ${format(date, "EEEE")}`;
  if (diff >= 7 && diff < 14) return `next ${format(date, "EEEE")}`;

  return `on ${format(date, "MMM d")}`;
}

export function splitTrailingParenthetical(text: string): {
  main: string;
  trailingParenthetical: string | null;
} {
  const match = text.match(/^(.*?)(\s*\([^()]+\))$/);

  if (!match) {
    return {
      main: text,
      trailingParenthetical: null,
    };
  }

  return {
    main: match[1],
    trailingParenthetical: match[2].trimStart(),
  };
}

export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// US States for form dropdowns
export const US_STATES = [
  { value: "AL", label: "Alabama" },
  { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" },
  { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" },
  { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" },
  { value: "DE", label: "Delaware" },
  { value: "FL", label: "Florida" },
  { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" },
  { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" },
  { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" },
  { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" },
  { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" },
  { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" },
  { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" },
  { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" },
  { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" },
  { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" },
  { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" },
  { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" },
  { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" },
  { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" },
  { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" },
  { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" },
  { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" },
  { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" },
  { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" },
  { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" },
  { value: "WY", label: "Wyoming" },
];
