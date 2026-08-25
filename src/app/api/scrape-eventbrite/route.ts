import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { inferCategoriesFromText } from "@/server/utils/inferCategories";

const EVENTBRITE_API_BASE = "https://www.eventbriteapi.com/v3";
const MAX_PAGES = 20;

type EventbriteText = { text?: string | null; html?: string | null } | null;

interface EventbriteAddress {
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country?: string | null;
  localized_address_display?: string | null;
}

interface EventbriteEvent {
  id?: string;
  name?: EventbriteText;
  description?: EventbriteText;
  summary?: string | null;
  url?: string | null;
  status?: string | null;
  online?: boolean;
  start?: { utc?: string | null; timezone?: string | null } | null;
  end?: { utc?: string | null; timezone?: string | null } | null;
  logo?: { url?: string | null; original?: { url?: string | null } } | null;
  venue?: {
    name?: string | null;
    address?: EventbriteAddress | null;
  } | null;
}

interface EventbriteEventsResponse {
  pagination?: {
    page_number?: number;
    page_count?: number;
    has_more_items?: boolean;
  };
  events?: EventbriteEvent[];
  error?: string;
  error_description?: string;
}

export function eventbriteOrganizerIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (
      hostname !== "eventbrite.com" &&
      !hostname.endsWith(".eventbrite.com")
    ) {
      return null;
    }

    const match = url.pathname.replace(/\/+$/, "").match(/\/o\/[^/]*-(\d+)$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function plainText(value: EventbriteText | undefined): string | null {
  const direct = value?.text?.trim();
  if (direct) return direct;
  const html = value?.html?.trim();
  if (!html) return null;
  return cheerio.load(html).text().replace(/\s+/g, " ").trim() || null;
}

function buildAddress(address: EventbriteAddress | null | undefined) {
  if (address?.localized_address_display?.trim()) {
    return address.localized_address_display.trim();
  }
  return [
    address?.address_1,
    address?.address_2,
    address?.city,
    address?.region,
    address?.postal_code,
    address?.country,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

async function fetchOrganizerEventsPage(
  organizerId: string,
  token: string,
  page: number
): Promise<EventbriteEventsResponse> {
  const url = new URL(
    `${EVENTBRITE_API_BASE}/organizers/${organizerId}/events/`
  );
  url.searchParams.set("expand", "venue,organizer");
  if (page > 1) url.searchParams.set("page", String(page));

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const data = (await response
    .json()
    .catch(() => ({}))) as EventbriteEventsResponse;
  if (!response.ok) {
    throw new Error(
      data.error_description ||
        data.error ||
        `Eventbrite API returned ${response.status} ${response.statusText}`
    );
  }
  return data;
}

export async function scrapeEventbrite(organizerUrl: string) {
  const organizerId = eventbriteOrganizerIdFromUrl(organizerUrl);
  if (!organizerId) {
    throw new Error(
      "Invalid URL. Must be an Eventbrite organizer URL (https://www.eventbrite.com/o/name-123456)"
    );
  }

  const token = process.env.EVENTBRITE_PRIVATE_TOKEN?.trim();
  if (!token) {
    throw new Error("EVENTBRITE_PRIVATE_TOKEN is not configured");
  }

  const rawEvents: EventbriteEvent[] = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const data = await fetchOrganizerEventsPage(organizerId, token, page);
    rawEvents.push(...(data.events ?? []));
    if (!data.pagination?.has_more_items) break;
    page += 1;
  }

  const now = Date.now();
  const events = rawEvents.flatMap((event) => {
    const title = plainText(event.name) ?? "Untitled Event";
    const description =
      plainText(event.description) ?? event.summary?.trim() ?? null;
    const startAt = event.start?.utc;
    const endAt = event.end?.utc ?? null;
    const address = buildAddress(event.venue?.address);
    const city = event.venue?.address?.city?.trim() ?? "";
    const state = event.venue?.address?.region?.trim().toUpperCase() ?? "";
    const isCurrentOrFuture = Date.parse(endAt ?? startAt ?? "") >= now;

    if (
      !event.id ||
      !startAt ||
      !city ||
      state.length !== 2 ||
      event.status !== "live" ||
      !isCurrentOrFuture
    ) {
      return [];
    }

    return [
      {
        title,
        description,
        coverImageUrl: event.logo?.original?.url ?? event.logo?.url ?? null,
        eventUrl: event.url ?? null,
        externalId: event.id,
        startAt,
        endAt,
        timeZone: event.start?.timezone ?? null,
        venueName: event.online
          ? "Online event"
          : (event.venue?.name?.trim() ?? ""),
        address: address || null,
        city,
        state,
        categories: inferCategoriesFromText(title, description),
        visibility: "public" as const,
        source: "eventbrite" as const,
        eventStatus: event.status,
      },
    ];
  });

  return {
    organizer: { id: organizerId, url: organizerUrl },
    events,
    totalEvents: events.length,
    rawTotalEvents: rawEvents.length,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    return NextResponse.json(await scrapeEventbrite(body.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid URL") ? 400 : 502;
    return NextResponse.json(
      { error: `Scraping failed: ${message}` },
      { status }
    );
  }
}
