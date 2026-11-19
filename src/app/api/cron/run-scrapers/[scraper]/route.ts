import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { scrapers, scraperLogs, users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { rehostExistingScrapedEventImages } from "@/server/utils/scraped-event-images";
import { runScraper } from "@/server/scrapers/run-scraper";
import {
  isCronAuthorized,
  runnerMode,
  SCRAPER_TYPES,
  type ScraperType,
} from "@/server/scrapers/policy";
import { scraperStore } from "@/server/scrapers/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

function isScraperType(value: string): value is ScraperType {
  return SCRAPER_TYPES.some((scraper) => scraper === value);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAllScrapers(scraperType: ScraperType) {
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

  // Repair externally hosted images for this source independently of the
  // scrape response, without repeating the work for every scraper type.
  await rehostExistingScrapedEventImages([scraperType]);

  // Load all scrapers with place data
  const allScrapers = await db.query.scrapers.findMany({
    where: eq(scrapers.scraper, scraperType),
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
    scraper: scraperType,
    totalScrapers: allScrapers.length,
    totalEventsAdded: results.reduce((sum, r) => sum + r.eventsAdded, 0),
    results,
  });
}

type RouteContext = {
  params: Promise<{ scraper: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (runnerMode() !== "legacy") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Legacy runner is disabled",
      mode: runnerMode(),
    });
  }

  const { scraper } = await context.params;
  if (!isScraperType(scraper)) {
    return NextResponse.json(
      { error: `Unknown scraper type: ${scraper}` },
      { status: 404 }
    );
  }

  if (
    scraper === "posh" &&
    process.env.POSH_CRON_ENABLED?.toLowerCase() !== "true"
  ) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      scraper,
      reason: "Posh cron is disabled",
    });
  }

  const token = await scraperStore.acquireLock();
  if (!token)
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Another scraper runner is active",
    });

  try {
    return await runAllScrapers(scraper);
  } catch (error) {
    console.error(`${scraper} scraper cron failed:`, error);
    return NextResponse.json(
      { error: `${scraper} scraper cron failed` },
      { status: 500 }
    );
  } finally {
    await scraperStore.releaseLock(token);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  return GET(request, context);
}
