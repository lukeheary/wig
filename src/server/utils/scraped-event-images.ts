import { eq, inArray } from "drizzle-orm";
import { isStorageUrl, uploadImageFromUrl } from "@/lib/s3";
import { db } from "@/server/db";
import { events } from "@/server/db/schema";

export const SCRAPER_SOURCES = ["dice", "posh", "ticketmaster"] as const;
export type ScraperSource = (typeof SCRAPER_SOURCES)[number];

const REHOST_CONCURRENCY = 4;

/** Re-host one external scraped-event image and persist its storage URL. */
export async function rehostScrapedEventImage(
  eventId: string,
  sourceImageUrl: string | null | undefined,
  currentImageUrl?: string | null
): Promise<"updated" | "skipped" | "failed"> {
  if (!sourceImageUrl || isStorageUrl(currentImageUrl ?? sourceImageUrl)) {
    return "skipped";
  }

  try {
    const hostedImageUrl = await uploadImageFromUrl(
      sourceImageUrl,
      `events/${eventId}`,
      "cover-image.png"
    );
    await db
      .update(events)
      .set({ coverImageUrl: hostedImageUrl, updatedAt: new Date() })
      .where(eq(events.id, eventId));
    return "updated";
  } catch (error) {
    console.error(`Failed to re-host scraped image for event ${eventId}`, error);
    return "failed";
  }
}

/**
 * Repair existing scraper-created events independently of current scraper
 * results. Scrapers may stop returning expired events, and older imports may
 * use several different third-party image hosts.
 */
export async function rehostExistingScrapedEventImages(
  sources: readonly ScraperSource[] = SCRAPER_SOURCES
): Promise<{ found: number; updated: number; failed: number }> {
  if (sources.length === 0) return { found: 0, updated: 0, failed: 0 };

  const storedRows = await db.query.events.findMany({
    where: inArray(events.source, [...sources]),
    columns: {
      id: true,
      coverImageUrl: true,
    },
  });
  const rows = storedRows.filter(
    (row) => row.coverImageUrl && !isStorageUrl(row.coverImageUrl)
  );

  let updated = 0;
  let failed = 0;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < rows.length) {
      const row = rows[nextIndex++];
      if (!row?.coverImageUrl) continue;

      const result = await rehostScrapedEventImage(
        row.id,
        row.coverImageUrl,
        row.coverImageUrl
      );
      if (result === "updated") updated += 1;
      if (result === "failed") failed += 1;
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(REHOST_CONCURRENCY, rows.length) },
      () => worker()
    )
  );

  return { found: rows.length, updated, failed };
}
