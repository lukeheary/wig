import { auth } from "@clerk/nextjs/server";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveMobileEventEditPermissions } from "@/app/api/mobile/event-edit-permissions";
import { scrapeDice } from "@/app/api/scrape-dice/route";
import { scrapePosh } from "@/app/api/scrape-posh/route";
import { scrapeTicketmaster } from "@/app/api/scrape-ticketmaster/route";
import { db } from "@/server/db";
import { events, places, scrapers, users } from "@/server/db/schema";
import { EVENT_STATUS_VALUES } from "@/lib/event-status";
import {
  filterExistingCategoryKeys,
  setEventCategoryKeys,
} from "@/server/utils/categories";
import { logEventActivity } from "@/server/utils/event-activity-logger";

const scraperTypeSchema = z.enum(["dice", "posh", "ticketmaster"]);

const runScraperSchema = z.object({
  scraperId: z.string().uuid(),
  prefetchedGroups: z
    .array(
      z.object({
        groupUrl: z.string().url(),
        data: z.unknown(),
      })
    )
    .max(20)
    .optional(),
});

const importScrapedEventsSchema = z.object({
  scraperId: z.string().uuid(),
  overrideExisting: z.boolean().default(false),
  events: z.array(
    z.object({
      title: z.string().min(1).max(255),
      description: z.string().nullable().optional(),
      coverImageUrl: z.string().url().nullable().optional(),
      eventUrl: z.string().url().nullable().optional(),
      externalId: z.string().nullable().optional(),
      source: z.string().max(50).nullable().optional(),
      startAt: z.string().min(1),
      endAt: z.string().nullable().optional(),
      venueName: z.string().optional().default(""),
      address: z.string().nullable().optional(),
      city: z.string().min(1).max(100),
      state: z.string().length(2),
      categories: z.array(z.string()).optional().default([]),
      visibility: z.enum(["public", "private"]).default("public"),
      status: z.enum(EVENT_STATUS_VALUES).default("active"),
      timeZone: z.string().trim().min(1).max(64).nullable().optional(),
      venueId: z.string().uuid().nullable().optional(),
    })
  ),
});

async function currentMobileUserContext() {
  const { userId } = await auth();

  if (userId) {
    return { userId, isPreview: false };
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: {
      id: true,
    },
  });

  return {
    userId: previewUser?.id ?? null,
    isPreview: true,
  };
}

async function assertMobileAdmin() {
  const { userId } = await currentMobileUserContext();
  if (!userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const permissions = await resolveMobileEventEditPermissions(userId);
  if (!permissions.isAdmin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { userId };
}

function normalizeMatchText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWordSet(...values: Array<string | null | undefined>) {
  return new Set(
    values
      .flatMap((value) => normalizeMatchText(value).split(" "))
      .map((value) => value.trim())
      .filter((value) => value.length > 1)
  );
}

function safeUrlValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function scoreScrapedVenueMatch(
  scraped: {
    venueName: string;
    city?: string | null;
    state?: string | null;
    address?: string | null;
  },
  place: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    address: string | null;
    website: string | null;
  }
) {
  const scrapedName = normalizeMatchText(scraped.venueName);
  const placeName = normalizeMatchText(place.name);

  if (!scrapedName || !placeName) {
    return -1;
  }

  const scrapedCity = normalizeMatchText(scraped.city);
  const scrapedState = normalizeMatchText(scraped.state);
  const placeCity = normalizeMatchText(place.city);
  const placeState = normalizeMatchText(place.state);

  if (scrapedState && placeState && scrapedState !== placeState) {
    return -1;
  }

  const locationWords = getWordSet(
    scraped.city,
    scraped.state,
    scraped.address,
    place.city,
    place.state,
    place.address
  );

  const stripLocationWords = (value: string) =>
    value
      .split(" ")
      .filter((word) => !locationWords.has(word))
      .join(" ")
      .trim();

  const scrapedCore = stripLocationWords(scrapedName);
  const placeCore = stripLocationWords(placeName);

  let score = -1;

  if (scrapedName === placeName) {
    score = 1000;
  } else if (scrapedCore && scrapedCore === placeName) {
    score = 950;
  } else if (placeCore && scrapedName === placeCore) {
    score = 945;
  } else if (scrapedCore && placeCore && scrapedCore === placeCore) {
    score = 920;
  } else if (
    scrapedName.startsWith(`${placeName} `) &&
    stripLocationWords(scrapedName.slice(placeName.length)).length === 0
  ) {
    score = 900;
  } else if (
    placeName.startsWith(`${scrapedName} `) &&
    stripLocationWords(placeName.slice(scrapedName.length)).length === 0
  ) {
    score = 890;
  }

  if (score < 0) {
    return -1;
  }

  if (scrapedCity && placeCity && scrapedCity === placeCity) {
    score += 20;
  }

  if (scrapedState && placeState && scrapedState === placeState) {
    score += 10;
  }

  return score;
}

async function runSelectedScraper(
  scraperId: string,
  prefetchedGroups: Array<{ groupUrl: string; data: unknown }> = []
) {
  const row = await db.query.scrapers.findFirst({
    where: eq(scrapers.id, scraperId),
    with: {
      place: true,
    },
  });

  if (!row) {
    throw new Error("Scraper not found");
  }

  let result: any;
  if (row.scraper === "dice") {
    result = await scrapeDice(row.searchString);
  } else if (row.scraper === "posh") {
    const urls = row.searchString
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (urls.length == 0) {
      throw new Error("This Posh scraper has an empty search string.");
    }

    result = await scrapePosh(urls, prefetchedGroups);
  } else {
    if (!row.place.state) {
      throw new Error("Ticketmaster scrapers require the linked venue to have a 2-letter state code.");
    }

    result = await scrapeTicketmaster({
      venueName: row.searchString,
      stateCode: row.place.state,
      classificationName: row.classificationName ?? undefined,
    });
  }

  let venueMatches: Array<any> = [];
  if (row.place.type === "organizer" && Array.isArray(result.events) && result.events.length > 0) {
    const venuePlaces = await db
      .select({
        id: places.id,
        name: places.name,
        city: places.city,
        state: places.state,
        address: places.address,
        website: places.website,
      })
      .from(places)
      .where(eq(places.type, "venue"));

    venueMatches = result.events.map((event: any) => {
      const scoredMatches = venuePlaces
        .map((place) => ({
          place,
          score: scoreScrapedVenueMatch(
            {
              venueName: event.venueName ?? "",
              city: event.city,
              state: event.state,
              address: event.address,
            },
            place
          ),
        }))
        .filter((item) => item.score >= 0)
        .sort((a, b) => b.score - a.score);

      const bestMatch = scoredMatches[0];
      const secondMatch = scoredMatches[1];
      return bestMatch &&
        bestMatch.score >= 900 &&
        (!secondMatch || secondMatch.score < bestMatch.score)
        ? bestMatch.place
        : null;
    });
  }

  return {
    scraperRow: {
      id: row.id,
      placeId: row.placeId,
      scraper: row.scraper,
      searchString: row.searchString,
      classificationName: row.classificationName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      place: {
        id: row.place.id,
        type: row.place.type,
        slug: row.place.slug,
        name: row.place.name,
        city: row.place.city,
        state: row.place.state,
        website: safeUrlValue(row.place.website),
      },
    },
    venue: result.venue ?? null,
    organizer: result.organizer ?? null,
    totalEvents: result.totalEvents ?? result.events?.length ?? 0,
    errors: result.errors ?? [],
    events: (result.events ?? []).map((event: any, index: number) => ({
      ...event,
      venueMatch: venueMatches[index]
        ? {
            id: venueMatches[index].id,
            name: venueMatches[index].name,
            city: venueMatches[index].city,
            state: venueMatches[index].state,
            website: safeUrlValue(venueMatches[index].website),
          }
        : null,
    })),
  };
}

export async function GET(request: Request) {
  const authResult = await assertMobileAdmin();
  if ("error" in authResult) {
    return authResult.error;
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim();

  const rows = await db.query.scrapers.findMany({
    with: {
      place: true,
    },
    orderBy: [desc(scrapers.updatedAt)],
  });

  const normalizedSearch = search?.toLowerCase() ?? "";
  const filteredRows = normalizedSearch.length === 0
    ? rows
    : rows.filter(
        (row) =>
          row.searchString.toLowerCase().includes(normalizedSearch) ||
          row.place.name.toLowerCase().includes(normalizedSearch)
      );

  return NextResponse.json({
    scrapers: filteredRows.map((row) => ({
      id: row.id,
      placeId: row.placeId,
      scraper: row.scraper,
      searchString: row.searchString,
      classificationName: row.classificationName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      place: {
        id: row.place.id,
        type: row.place.type,
        slug: row.place.slug,
        name: row.place.name,
        city: row.place.city,
        state: row.place.state,
        website: safeUrlValue(row.place.website),
      },
    })),
  });
}

export async function POST(request: Request) {
  const authResult = await assertMobileAdmin();
  if ("error" in authResult) {
    return authResult.error;
  }

  try {
    const body = runScraperSchema.parse(await request.json());
    const result = await runSelectedScraper(
      body.scraperId,
      body.prefetchedGroups?.map(({ groupUrl, data }) => ({ groupUrl, data }))
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run scraper";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const authResult = await assertMobileAdmin();
  if ("error" in authResult) {
    return authResult.error;
  }

  try {
    const { userId } = authResult;
    const body = importScrapedEventsSchema.parse(await request.json());
    const row = await db.query.scrapers.findFirst({
      where: eq(scrapers.id, body.scraperId),
      with: {
        place: true,
      },
    });

    if (!row) {
      return NextResponse.json({ error: "Scraper not found" }, { status: 404 });
    }

    if (body.events.length === 0) {
      return NextResponse.json({ created: 0 });
    }

    const toEventKey = (event: {
      source?: string | null;
      externalId?: string | null;
      title: string;
      startAt: Date;
      city: string;
      state: string;
    }) =>
      event.source && event.externalId
        ? `${event.source}::${event.externalId}`
        : `${event.title}::${event.startAt.toISOString()}::${event.city}::${event.state}`;

    const parsedEvents = body.events.map((event) => ({
      ...event,
      startAtDate: new Date(event.startAt),
      endAtDate: event.endAt ? new Date(event.endAt) : undefined,
      normalizedState: event.state.trim().toUpperCase(),
    }));

    let dedupedEvents = parsedEvents;

    if (!body.overrideExisting) {
      const eventsWithExternal = parsedEvents.filter(
        (event) => event.source && event.externalId
      );
      const existingKeys = new Set<string>();

      if (eventsWithExternal.length > 0) {
        const bySource = new Map<string, Set<string>>();
        eventsWithExternal.forEach((event) => {
          if (!event.source || !event.externalId) return;
          const set = bySource.get(event.source) ?? new Set<string>();
          set.add(event.externalId);
          bySource.set(event.source, set);
        });

        for (const [source, ids] of bySource.entries()) {
          const rows = await db.query.events.findMany({
            where: and(
              eq(events.source, source),
              inArray(events.externalId, Array.from(ids))
            ),
            columns: {
              source: true,
              externalId: true,
            },
          });

          rows.forEach((row) => {
            if (row.source && row.externalId) {
              existingKeys.add(`${row.source}::${row.externalId}`);
            }
          });
        }
      }

      const seenKeys = new Set<string>();
      dedupedEvents = parsedEvents.filter((event) => {
        if (event.source && event.externalId) {
          const key = `${event.source}::${event.externalId}`;
          if (existingKeys.has(key)) return false;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
        }
        return true;
      });
    }

    if (dedupedEvents.length === 0) {
      return NextResponse.json({ created: 0 });
    }

    const validBatchCategoryKeys = new Set(
      await filterExistingCategoryKeys(
        db,
        Array.from(new Set(dedupedEvents.flatMap((event) => event.categories ?? []))),
        { activeOnly: true }
      )
    );

    const values = dedupedEvents.map((event) => {
      const categoryKeys = (event.categories ?? []).filter((key) =>
        validBatchCategoryKeys.has(key)
      );

      return {
        eventKey: toEventKey({
          source: event.source,
          externalId: event.externalId,
          title: event.title,
          startAt: event.startAtDate,
          city: event.city,
          state: event.normalizedState,
        }),
        categoryKeys,
        data: {
          title: event.title,
          description: event.description ?? null,
          coverImageUrl: event.coverImageUrl ?? null,
          eventUrl: event.eventUrl ?? null,
          source: event.source ?? null,
          externalId: event.externalId ?? null,
          startAt: event.startAtDate,
          timeZone: event.timeZone ?? null,
          endAt: event.endAtDate ?? null,
          address: event.address ?? null,
          city: event.city,
          state: event.normalizedState,
          visibility: event.visibility,
          status: event.status,
          createdByUserId: userId,
          venueId: row.place.type === "venue" ? row.placeId : event.venueId ?? null,
          organizerId: row.place.type === "organizer" ? row.placeId : null,
        },
      };
    });

    const insertQuery = db
      .insert(events)
      .values(values.map((value) => value.data) as any);

    const upserted = await (
      body.overrideExisting
        ? insertQuery.onConflictDoUpdate({
            target: [events.source, events.externalId],
            set: {
              title: sql`excluded.title`,
              description: sql`excluded.description`,
              coverImageUrl: sql`excluded.cover_image_url`,
              eventUrl: sql`excluded.event_url`,
              startAt: sql`excluded.start_at`,
              timeZone: sql`excluded.time_zone`,
              endAt: sql`excluded.end_at`,
              address: sql`excluded.address`,
              city: sql`excluded.city`,
              state: sql`excluded.state`,
              venueId: sql`excluded.venue_id`,
              organizerId: sql`excluded.organizer_id`,
              updatedAt: sql`now()`,
            },
          })
        : insertQuery.onConflictDoNothing({
            target: [events.source, events.externalId],
          })
    ).returning();

    const categoryKeysByEventKey = new Map(
      values.map((value) => [value.eventKey, value.categoryKeys])
    );

    const newlyCreated = body.overrideExisting ? [] : upserted;
    if (newlyCreated.length > 0) {
      await Promise.all(
        newlyCreated.map((row) =>
          logEventActivity({
            actorUserId: userId,
            eventId: row.id,
            type: "created",
            metadata: {
              status: row.status,
              createdVia: "mobile_scraper_import",
            },
          })
        )
      );
    }

    if (upserted.length > 0) {
      await Promise.all(
        upserted.map(async (row) => {
          const rowEventKey = toEventKey({
            source: row.source,
            externalId: row.externalId,
            title: row.title,
            startAt: row.startAt,
            city: row.city,
            state: row.state,
          });
          const categoryKeys = categoryKeysByEventKey.get(rowEventKey) || [];
          if (categoryKeys.length === 0) return;
          await setEventCategoryKeys(db, row.id, categoryKeys, {
            activeOnly: true,
          });
        })
      );
    }

    return NextResponse.json({ created: upserted.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Failed to import events";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
