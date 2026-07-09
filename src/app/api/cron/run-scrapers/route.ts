import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { scrapers, scraperLogs, events, users } from "@/server/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  filterExistingCategoryKeys,
  setEventCategoryKeys,
} from "@/server/utils/categories";
import { uploadImageFromUrl } from "@/lib/s3";
import { scrapeDice } from "@/app/api/scrape-dice/route";
import { scrapePosh } from "@/app/api/scrape-posh/route";
import { scrapeTicketmaster } from "@/app/api/scrape-ticketmaster/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ScrapedEvent {
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  eventUrl: string | null;
  externalId: string | null;
  startAt: string;
  endAt: string | null;
  city: string;
  state: string;
  categories: string[];
  visibility: "public";
  source: string;
}

async function runScraper(
  scraperRow: {
    id: string;
    placeId: string;
    scraper: "dice" | "posh" | "ticketmaster";
    searchString: string;
    classificationName: string | null;
    place: {
      type: "venue" | "organizer";
      name: string;
      city: string | null;
      state: string | null;
      website: string | null;
    };
  },
  adminUserId: string
): Promise<{
  status: "success" | "error" | "partial";
  eventsFound: number;
  eventsAdded: number;
  error: string | null;
  data: {
    eventsFound: { title: string; externalId: string | null }[];
    eventsAdded: { id: string; title: string; externalId: string | null }[];
  };
}> {
  let scrapeResult: { events: ScrapedEvent[]; errors?: { url: string; error: string }[] };

  try {
    if (scraperRow.scraper === "dice") {
      scrapeResult = await scrapeDice(scraperRow.searchString);
    } else if (scraperRow.scraper === "posh") {
      const urls = scraperRow.searchString
        .split(/[\n,]+/)
        .map((v) => v.trim())
        .filter(Boolean);
      if (urls.length === 0) {
        return {
          status: "error",
          eventsFound: 0,
          eventsAdded: 0,
          error: "Posh scraper has an empty search string",
          data: { eventsFound: [], eventsAdded: [] },
        };
      }
      scrapeResult = await scrapePosh(urls);
    } else if (scraperRow.scraper === "ticketmaster") {
      if (!scraperRow.place.state) {
        return {
          status: "error",
          eventsFound: 0,
          eventsAdded: 0,
          error: "Ticketmaster scraper requires venue to have a state code",
          data: { eventsFound: [], eventsAdded: [] },
        };
      }
      scrapeResult = await scrapeTicketmaster({
        venueName: scraperRow.searchString,
        stateCode: scraperRow.place.state,
        classificationName: scraperRow.classificationName ?? undefined,
      });
    } else {
      return {
        status: "error",
        eventsFound: 0,
        eventsAdded: 0,
        error: `Unknown scraper type: ${scraperRow.scraper}`,
        data: { eventsFound: [], eventsAdded: [] },
      };
    }
  } catch (err) {
    return {
      status: "error",
      eventsFound: 0,
      eventsAdded: 0,
      error: err instanceof Error ? err.message : "Scraper error",
      data: { eventsFound: [], eventsAdded: [] },
    };
  }

  const scrapedEvents = scrapeResult.events ?? [];
  const eventsFoundData = scrapedEvents.map((e) => ({
    title: e.title,
    externalId: e.externalId,
  }));

  if (scrapedEvents.length === 0) {
    return {
      status: "success",
      eventsFound: 0,
      eventsAdded: 0,
      error: null,
      data: { eventsFound: [], eventsAdded: [] },
    };
  }

  const venueId =
    scraperRow.place.type === "venue" ? scraperRow.placeId : undefined;
  const organizerId =
    scraperRow.place.type === "organizer" ? scraperRow.placeId : undefined;

  // Collect all category keys for batch validation
  const allCategoryKeys = Array.from(
    new Set(scrapedEvents.flatMap((e) => e.categories ?? []))
  );
  const validCategoryKeys = new Set(
    await filterExistingCategoryKeys(db, allCategoryKeys, { activeOnly: true })
  );

  const insertValues = scrapedEvents
    .map((e) => ({
      title: e.title,
      description: e.description ?? null,
      coverImageUrl: e.coverImageUrl ?? null,
      eventUrl: e.eventUrl ?? scraperRow.place.website ?? null,
      source: e.source ?? null,
      externalId: e.externalId ?? null,
      startAt: new Date(e.startAt),
      endAt: e.endAt ? new Date(e.endAt) : null,
      city: e.city || scraperRow.place.city || "",
      state: e.state || scraperRow.place.state || "",
      venueId: venueId ?? null,
      organizerId: organizerId ?? null,
      visibility: "public" as const,
      status: "active" as const,
      createdByUserId: adminUserId,
    }))
    .filter((v) => v.city && v.state);

  if (insertValues.length === 0) {
    return {
      status: "partial",
      eventsFound: scrapedEvents.length,
      eventsAdded: 0,
      error: "All events missing city/state",
      data: { eventsFound: eventsFoundData, eventsAdded: [] },
    };
  }

  let upserted: {
    id: string;
    title: string;
    source: string | null;
    externalId: string | null;
  }[] = [];

  try {
    upserted = await db
      .insert(events)
      .values(insertValues as any)
      .onConflictDoNothing({ target: [events.source, events.externalId] })
      .returning({
        id: events.id,
        title: events.title,
        source: events.source,
        externalId: events.externalId,
      });
  } catch (err) {
    return {
      status: "error",
      eventsFound: scrapedEvents.length,
      eventsAdded: 0,
      error: err instanceof Error ? err.message : "DB insert error",
      data: { eventsFound: eventsFoundData, eventsAdded: [] },
    };
  }

  // If an event already existed, still enrich it with a venue/organizer link
  // when the scraper now knows that relationship and the stored row does not.
  if (venueId || organizerId) {
    const linkableEvents = insertValues.filter(
      (value) => value.source && value.externalId
    );

    await Promise.allSettled(
      linkableEvents.map(async (value) => {
        const updates: Partial<{
          venueId: string | null;
          organizerId: string | null;
        }> = {};
        const missingLinkConditions = [];

        if (venueId) {
          updates.venueId = venueId;
          missingLinkConditions.push(isNull(events.venueId));
        }

        if (organizerId) {
          updates.organizerId = organizerId;
          missingLinkConditions.push(isNull(events.organizerId));
        }

        if (
          Object.keys(updates).length === 0 ||
          missingLinkConditions.length === 0
        ) {
          return;
        }

        await db
          .update(events)
          .set(updates)
          .where(
            and(
              eq(events.source, value.source!),
              eq(events.externalId, value.externalId!),
              or(...missingLinkConditions)
            )
          );
      })
    );
  }

  // Set categories for newly inserted events
  if (upserted.length > 0) {
    const categoryMap = new Map<string, string[]>();
    scrapedEvents.forEach((e) => {
      if (e.externalId) {
        categoryMap.set(
          e.externalId,
          (e.categories ?? []).filter((k) => validCategoryKeys.has(k))
        );
      }
    });

    await Promise.all(
      upserted.map(async (row) => {
        const cats = row.externalId
          ? (categoryMap.get(row.externalId) ?? [])
          : [];
        if (cats.length > 0) {
          await setEventCategoryKeys(db, row.id, cats, { activeOnly: true });
        }
      })
    );

    await Promise.allSettled(
      upserted.map(async (row) => {
        const scrapedEvent = scrapedEvents.find(
          (event) =>
            event.source === row.source && event.externalId === row.externalId
        );
        const originalCoverImageUrl = scrapedEvent?.coverImageUrl;

        if (!originalCoverImageUrl) {
          return;
        }

        try {
          const s3Url = await uploadImageFromUrl(
            originalCoverImageUrl,
            `events/${row.id}`,
            "cover-image.png"
          );

          await db
            .update(events)
            .set({ coverImageUrl: s3Url })
            .where(eq(events.id, row.id));
        } catch {
          // Keep the original external URL if re-hosting fails.
        }
      })
    );
  }

  const eventsAddedData = upserted.map((r) => ({
    id: r.id,
    title: r.title,
    externalId: r.externalId,
  }));

  const hasErrors = (scrapeResult.errors?.length ?? 0) > 0;

  return {
    status: hasErrors && upserted.length === 0 ? "partial" : "success",
    eventsFound: scrapedEvents.length,
    eventsAdded: upserted.length,
    error: hasErrors
      ? `Some URLs failed: ${scrapeResult.errors!.map((e) => e.error).join("; ")}`
      : null,
    data: { eventsFound: eventsFoundData, eventsAdded: eventsAddedData },
  };
}

async function runAllScrapers() {
  // Find admin user for createdByUserId
  const [adminUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);

  if (!adminUser) {
    return NextResponse.json(
      { error: "No admin user found to attribute events to" },
      { status: 500 }
    );
  }

  // Load all scrapers with place data
  const allScrapers = await db.query.scrapers.findMany({
    with: {
      place: {
        columns: {
          id: true,
          type: true,
          name: true,
          city: true,
          state: true,
          website: true,
        },
      },
    },
  });

  const results: Array<{
    scraperId: string;
    placeName: string;
    scraper: string;
    status: string;
    eventsFound: number;
    eventsAdded: number;
    durationMs: number;
    error: string | null;
  }> = [];

  let lastTicketmasterRanAt: number | null = null;

  for (const scraperRow of allScrapers) {
    // Rate limiting: wait 3s between Ticketmaster requests
    if (
      scraperRow.scraper === "ticketmaster" &&
      lastTicketmasterRanAt !== null
    ) {
      const elapsed = Date.now() - lastTicketmasterRanAt;
      if (elapsed < 3000) {
        await sleep(3000 - elapsed);
      }
    }

    const startTime = Date.now();
    const result = await runScraper(scraperRow as any, adminUser.id);
    const durationMs = Date.now() - startTime;

    if (scraperRow.scraper === "ticketmaster") {
      lastTicketmasterRanAt = Date.now();
    }

    // Write log entry
    await db.insert(scraperLogs).values({
      scraperId: scraperRow.id,
      placeId: scraperRow.placeId,
      placeName: scraperRow.place.name,
      scraper: scraperRow.scraper,
      status: result.status,
      eventsFound: result.eventsFound,
      eventsAdded: result.eventsAdded,
      durationMs,
      error: result.error,
      data: result.data as any,
    });

    results.push({
      scraperId: scraperRow.id,
      placeName: scraperRow.place.name,
      scraper: scraperRow.scraper,
      status: result.status,
      eventsFound: result.eventsFound,
      eventsAdded: result.eventsAdded,
      durationMs,
      error: result.error,
    });
  }

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    totalScrapers: allScrapers.length,
    totalEventsAdded: results.reduce((sum, r) => sum + r.eventsAdded, 0),
    results,
  });
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await runAllScrapers();
  } catch (error) {
    console.error("Scraper cron failed:", error);
    return NextResponse.json(
      { error: "Scraper cron failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
