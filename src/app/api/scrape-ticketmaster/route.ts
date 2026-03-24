import { NextRequest, NextResponse } from "next/server";
import { inferCategoriesFromTicketmaster } from "@/server/utils/inferCategories";

const TICKETMASTER_BASE_URL = "https://app.ticketmaster.com/discovery/v2";

interface TicketmasterVenue {
  id?: string;
  name?: string;
  address?: {
    line1?: string;
    line2?: string;
  };
  city?: {
    name?: string;
  };
  state?: {
    stateCode?: string;
  };
}

interface TicketmasterEvent {
  id?: string;
  name?: string;
  info?: string;
  pleaseNote?: string;
  url?: string;
  images?: Array<{ url?: string; width?: number; height?: number }>;
  dates?: {
    start?: {
      dateTime?: string;
      localDate?: string;
      localTime?: string;
    };
    end?: {
      dateTime?: string;
      localDate?: string;
      localTime?: string;
    };
    status?: {
      code?: string;
    };
  };
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
  }>;
  _embedded?: {
    venues?: TicketmasterVenue[];
  };
}

interface ScrapedEvent {
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  eventUrl: string | null;
  externalId: string | null;
  startAt: string;
  endAt: string | null;
  venueName: string;
  address: string;
  city: string;
  state: string;
  categories: string[];
  visibility: "public";
  source: "ticketmaster";
  eventStatus: string;
}

function buildTicketmasterUrl(
  path: string,
  params: Record<string, string | undefined>
) {
  const url = new URL(`${TICKETMASTER_BASE_URL}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

function pickBestImage(images?: Array<{ url?: string; width?: number }>) {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return sorted[0]?.url ?? null;
}

function buildAddress(venue?: TicketmasterVenue) {
  const parts = [venue?.address?.line1, venue?.address?.line2].filter(Boolean);
  return parts.join(", ");
}

function buildDateTime(value?: {
  dateTime?: string;
  localDate?: string;
  localTime?: string;
}) {
  if (!value) return null;
  if (value.dateTime) return value.dateTime;
  if (value.localDate) {
    const time = value.localTime ?? "00:00:00";
    return `${value.localDate}T${time}`;
  }
  return null;
}

function mapCategories(event: TicketmasterEvent) {
  return inferCategoriesFromTicketmaster(
    event.classifications ?? [],
    event.name ?? "",
    event.info ?? event.pleaseNote ?? null
  );
}

export async function POST(request: NextRequest) {
  try {
    const { venueName, stateCode, classificationName } = await request.json();

    if (!venueName || typeof venueName !== "string") {
      return NextResponse.json(
        { error: "venueName is required" },
        { status: 400 }
      );
    }

    if (!stateCode || typeof stateCode !== "string") {
      return NextResponse.json(
        { error: "stateCode is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "TICKETMASTER_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const normalizedState = stateCode.trim().toUpperCase();
    const normalizedVenueName = venueName.trim();
    const normalizedClassificationName =
      typeof classificationName === "string" && classificationName.trim()
        ? classificationName.trim()
        : undefined;

    const venueSearchUrl = buildTicketmasterUrl("venues.json", {
      apikey: apiKey,
      keyword: normalizedVenueName,
      stateCode: normalizedState,
      countryCode: "US",
      size: "10",
    });

    const venueResponse = await fetch(venueSearchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!venueResponse.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch Ticketmaster venues: ${venueResponse.status} ${venueResponse.statusText}`,
        },
        { status: 502 }
      );
    }

    const venueData = (await venueResponse.json()) as {
      _embedded?: { venues?: TicketmasterVenue[] };
    };

    const venues = venueData._embedded?.venues ?? [];

    if (venues.length === 0) {
      return NextResponse.json(
        { error: "No venues found for that search" },
        { status: 404 }
      );
    }

    const normalizedName = normalizedVenueName.toLowerCase();
    const matchedVenue =
      venues.find((venue) => venue.name?.toLowerCase() === normalizedName) ||
      venues.find((venue) =>
        venue.name?.toLowerCase().includes(normalizedName)
      ) ||
      venues[0];

    if (!matchedVenue?.id) {
      return NextResponse.json(
        { error: "Unable to resolve venue ID" },
        { status: 404 }
      );
    }

    const eventsUrl = buildTicketmasterUrl("events.json", {
      apikey: apiKey,
      venueId: matchedVenue.id,
      classificationName: normalizedClassificationName,
      sort: "date,asc",
      size: "100",
    });

    const eventsResponse = await fetch(eventsUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!eventsResponse.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch Ticketmaster events: ${eventsResponse.status} ${eventsResponse.statusText}`,
        },
        { status: 502 }
      );
    }

    const eventsData = (await eventsResponse.json()) as {
      _embedded?: { events?: TicketmasterEvent[] };
    };

    const rawEvents = eventsData._embedded?.events ?? [];

    const events = rawEvents.reduce<ScrapedEvent[]>((acc, event) => {
      const venue = event._embedded?.venues?.[0] ?? matchedVenue;
      const startAt = buildDateTime(event.dates?.start);
      const endAt = buildDateTime(event.dates?.end);

      if (!startAt) return acc;

      const city = venue?.city?.name || "Unknown";
      const state = venue?.state?.stateCode || normalizedState || "XX";

      acc.push({
        title: event.name || "Untitled Event",
        description: event.info || event.pleaseNote || null,
        coverImageUrl: pickBestImage(event.images),
        eventUrl: event.url || null,
        externalId: event.id || event.url || null,
        startAt,
        endAt,
        venueName: venue?.name || matchedVenue.name || "Unknown Venue",
        address: buildAddress(venue),
        city,
        state,
        categories: mapCategories(event),
        visibility: "public",
        source: "ticketmaster",
        eventStatus: event.dates?.status?.code || "unknown",
      });

      return acc;
    }, []);

    return NextResponse.json({
      venue: {
        id: matchedVenue.id,
        name: matchedVenue.name ?? "Unknown Venue",
        address: buildAddress(matchedVenue),
        city: matchedVenue.city?.name ?? "Unknown",
        state: matchedVenue.state?.stateCode ?? normalizedState ?? "XX",
      },
      events,
      totalEvents: events.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Scraping failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
