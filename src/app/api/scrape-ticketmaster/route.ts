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

interface TicketmasterAttraction {
  id?: string;
  name?: string;
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
    attractions?: TicketmasterAttraction[];
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

const TITLE_SEGMENT_SPLIT_REGEX = /\s+(?:-|:|\||–|—)\s+/;
const NEAR_DUPLICATE_TIME_WINDOW_MS = 2 * 60 * 60 * 1000;
const OFFER_SIGNAL_PATTERNS = [
  /\b(?:ticket|tickets|package|packages|pass|passes)\b/i,
  /\b(?:vip|premium|platinum|upgrade|experience|lounge|suite|club)\b/i,
  /\b(?:parking|fast lane|early entry|meet and greet)\b/i,
  /\b(?:charity|donation|benefit|fundraiser|support)\b/i,
  /\b(?:delivery delay|tax deductible|purchase price)\b/i,
] as const;

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

function normalizeComparableText(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function countOfferSignals(value?: string | null) {
  const text = value ?? "";
  return OFFER_SIGNAL_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0
  );
}

function stripOfferSuffix(title?: string | null) {
  const rawTitle = title?.trim();
  if (!rawTitle) return "";

  const segments = rawTitle
    .split(TITLE_SEGMENT_SPLIT_REGEX)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length <= 1) {
    return rawTitle;
  }

  const keptSegments: string[] = [];
  for (const [index, segment] of segments.entries()) {
    const isOfferLike = countOfferSignals(segment) > 0;
    if (index > 0 && isOfferLike) {
      break;
    }
    keptSegments.push(segment);
  }

  return keptSegments.join(" - ");
}

function getAttractionNames(event: TicketmasterEvent) {
  return (event._embedded?.attractions ?? [])
    .map((attraction) => attraction.name?.trim())
    .filter((name): name is string => Boolean(name));
}

function getPrimaryAttractionKey(event: TicketmasterEvent) {
  return normalizeComparableText(getAttractionNames(event)[0]);
}

function getCanonicalTitleKey(event: TicketmasterEvent) {
  return normalizeComparableText(stripOfferSuffix(event.name));
}

function getIdentityDiscriminator(event: TicketmasterEvent) {
  return getPrimaryAttractionKey(event) || getCanonicalTitleKey(event);
}

function getEventLocalDate(event: TicketmasterEvent) {
  return (
    event.dates?.start?.localDate ||
    buildDateTime(event.dates?.start)?.slice(0, 10) ||
    ""
  );
}

function getEventTimestamp(event: TicketmasterEvent) {
  const startAt = buildDateTime(event.dates?.start);
  if (!startAt) return null;

  const timestamp = Date.parse(startAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isOfferLikeTicketmasterEvent(event: TicketmasterEvent) {
  const title = event.name ?? "";
  const description = `${event.info ?? ""} ${event.pleaseNote ?? ""}`.trim();
  const normalizedTitle = normalizeComparableText(title);
  const canonicalTitle = getCanonicalTitleKey(event);

  return (
    countOfferSignals(title) > 0 ||
    countOfferSignals(description) > 0 ||
    Boolean(canonicalTitle && canonicalTitle !== normalizedTitle)
  );
}

function countMatchedAttractionsInTitle(
  normalizedTitle: string,
  attractionNames: string[]
) {
  return attractionNames.reduce((count, attractionName) => {
    const normalizedAttraction = normalizeComparableText(attractionName);
    if (!normalizedAttraction) return count;
    return normalizedTitle.includes(normalizedAttraction) ? count + 1 : count;
  }, 0);
}

function buildEventGroupKey(
  event: TicketmasterEvent,
  venue: TicketmasterVenue | undefined,
  fallbackVenue: TicketmasterVenue,
  startAt: string
) {
  const venueKey = normalizeComparableText(
    venue?.name || fallbackVenue.name || "unknown venue"
  );
  const discriminator =
    getIdentityDiscriminator(event) || event.id || event.url || "unknown";

  return `${startAt}::${venueKey}::${discriminator}`;
}

function buildNearDuplicateGroupKey(
  event: TicketmasterEvent,
  venue: TicketmasterVenue | undefined,
  fallbackVenue: TicketmasterVenue
) {
  const venueKey = normalizeComparableText(
    venue?.name || fallbackVenue.name || "unknown venue"
  );
  const localDate = getEventLocalDate(event) || "unknown-date";
  const discriminator =
    getIdentityDiscriminator(event) || event.id || event.url || "unknown";

  return `${localDate}::${venueKey}::${discriminator}`;
}

function scoreTicketmasterEvent(event: TicketmasterEvent) {
  const title = event.name ?? "";
  const description = `${event.info ?? ""} ${event.pleaseNote ?? ""}`.trim();
  const normalizedTitle = normalizeComparableText(title);
  const normalizedCanonicalTitle = normalizeComparableText(
    stripOfferSuffix(title)
  );
  const attractionNames = getAttractionNames(event);
  const matchedAttractions = countMatchedAttractionsInTitle(
    normalizedTitle,
    attractionNames
  );
  const offerSignals =
    countOfferSignals(title) * 4 + countOfferSignals(description) * 2;
  const titleWordPenalty =
    Math.max(0, normalizedTitle.split(" ").length - 8) * 0.35;
  const descriptionWordPenalty =
    Math.max(0, normalizeComparableText(description).split(" ").length - 24) *
    0.08;
  const titleChangedBySuffixRemoval = Boolean(
    normalizedCanonicalTitle && normalizedCanonicalTitle !== normalizedTitle
  );

  return (
    matchedAttractions * 4 +
    Math.min(attractionNames.length, 3) * 1.5 +
    (event.images?.length ? 1 : 0) +
    (event.info ? 0.5 : 0) -
    offerSignals -
    titleWordPenalty -
    descriptionWordPenalty -
    (titleChangedBySuffixRemoval ? 2 : 0) -
    (event.pleaseNote ? 0.75 : 0)
  );
}

function pickPreferredTicketmasterEvent(
  current: TicketmasterEvent,
  candidate: TicketmasterEvent
) {
  const currentScore = scoreTicketmasterEvent(current);
  const candidateScore = scoreTicketmasterEvent(candidate);

  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? candidate : current;
  }

  const currentTitleLength = normalizeComparableText(current.name).length;
  const candidateTitleLength = normalizeComparableText(candidate.name).length;
  if (candidateTitleLength !== currentTitleLength) {
    return candidateTitleLength < currentTitleLength ? candidate : current;
  }

  const currentDescriptionLength = (current.info ?? current.pleaseNote ?? "")
    .length;
  const candidateDescriptionLength = (
    candidate.info ??
    candidate.pleaseNote ??
    ""
  ).length;
  if (candidateDescriptionLength !== currentDescriptionLength) {
    return candidateDescriptionLength < currentDescriptionLength
      ? candidate
      : current;
  }

  const currentTimestamp = getEventTimestamp(current);
  const candidateTimestamp = getEventTimestamp(candidate);
  if (
    currentTimestamp !== null &&
    candidateTimestamp !== null &&
    candidateTimestamp !== currentTimestamp
  ) {
    return candidateTimestamp > currentTimestamp ? candidate : current;
  }

  return candidate;
}

function collapseNearDuplicateTicketmasterEvents(
  events: TicketmasterEvent[],
  matchedVenue: TicketmasterVenue
) {
  const groupedEvents = events.reduce((groups, event) => {
    const venue = event._embedded?.venues?.[0] ?? matchedVenue;
    const groupKey = buildNearDuplicateGroupKey(event, venue, matchedVenue);
    const existing = groups.get(groupKey) ?? [];
    existing.push(event);
    groups.set(groupKey, existing);
    return groups;
  }, new Map<string, TicketmasterEvent[]>());

  return Array.from(groupedEvents.values()).flatMap((group) => {
    const sortedGroup = [...group].sort((a, b) => {
      const aTimestamp = getEventTimestamp(a) ?? Number.MAX_SAFE_INTEGER;
      const bTimestamp = getEventTimestamp(b) ?? Number.MAX_SAFE_INTEGER;
      return aTimestamp - bTimestamp;
    });

    const clusters: TicketmasterEvent[][] = [];
    for (const event of sortedGroup) {
      const timestamp = getEventTimestamp(event);
      const lastCluster = clusters[clusters.length - 1];
      const lastEvent = lastCluster?.[lastCluster.length - 1];
      const lastTimestamp = lastEvent ? getEventTimestamp(lastEvent) : null;

      if (
        !lastCluster ||
        timestamp === null ||
        lastTimestamp === null ||
        timestamp - lastTimestamp > NEAR_DUPLICATE_TIME_WINDOW_MS
      ) {
        clusters.push([event]);
        continue;
      }

      lastCluster.push(event);
    }

    return clusters.flatMap((cluster) => {
      if (cluster.length === 1) {
        return cluster;
      }

      const hasOfferLikeEvent = cluster.some(isOfferLikeTicketmasterEvent);
      const hasExactTitleMatch =
        new Set(cluster.map((event) => normalizeComparableText(event.name)))
          .size === 1;

      if (!hasOfferLikeEvent && !hasExactTitleMatch) {
        return cluster;
      }

      return [
        cluster.reduce((preferred, event) =>
          pickPreferredTicketmasterEvent(preferred, event)
        ),
      ];
    });
  });
}

function mapTicketmasterEventToScrapedEvent(
  event: TicketmasterEvent,
  matchedVenue: TicketmasterVenue,
  normalizedState: string
) {
  const venue = event._embedded?.venues?.[0] ?? matchedVenue;
  const startAt = buildDateTime(event.dates?.start);
  const endAt = buildDateTime(event.dates?.end);

  if (!startAt) return null;

  const city = venue?.city?.name || "Unknown";
  const state = venue?.state?.stateCode || normalizedState || "XX";

  return {
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
    visibility: "public" as const,
    source: "ticketmaster" as const,
    eventStatus: event.dates?.status?.code || "unknown",
  };
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

    const dedupedRawEvents = Array.from(
      rawEvents
        .reduce((groups, event) => {
          const venue = event._embedded?.venues?.[0] ?? matchedVenue;
          const startAt = buildDateTime(event.dates?.start);
          if (!startAt) {
            return groups;
          }

          const groupKey = buildEventGroupKey(
            event,
            venue,
            matchedVenue,
            startAt
          );
          const existing = groups.get(groupKey);
          groups.set(
            groupKey,
            existing ? pickPreferredTicketmasterEvent(existing, event) : event
          );
          return groups;
        }, new Map<string, TicketmasterEvent>())
        .values()
    );

    const collapsedRawEvents = collapseNearDuplicateTicketmasterEvents(
      dedupedRawEvents,
      matchedVenue
    );

    const events = collapsedRawEvents.reduce<ScrapedEvent[]>((acc, event) => {
      const mappedEvent = mapTicketmasterEventToScrapedEvent(
        event,
        matchedVenue,
        normalizedState
      );
      if (mappedEvent) {
        acc.push(mappedEvent);
      }
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
      rawTotalEvents: rawEvents.length,
      dedupedRawTotalEvents: collapsedRawEvents.length,
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
