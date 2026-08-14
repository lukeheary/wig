import { eq, inArray, sql } from "drizzle-orm";
import { isStorageUrl, uploadImageFromUrl } from "@/lib/s3";
import { db } from "@/server/db";
import { events } from "@/server/db/schema";

export const SCRAPER_SOURCES = ["dice", "posh", "ticketmaster"] as const;
export type ScraperSource = (typeof SCRAPER_SOURCES)[number];

const REHOST_CONCURRENCY = 4;

/**
 * Scraper synchronization can refresh non-feed metadata without making an
 * event look newly changed. Only user-visible What's New fields advance the
 * activity timestamp.
 */
export function meaningfulScraperUpdatedAt() {
  return sql<Date>`case
    when ${events.title} is distinct from excluded.title
      or ${events.startAt} is distinct from excluded.start_at
      or ${events.endAt} is distinct from excluded.end_at
      or (
        ${events.sourceImageUrl} is not null
        and ${events.sourceImageUrl} is distinct from excluded.source_image_url
      )
    then now()
    else ${events.updatedAt}
  end`;
}

/** Re-host one external scraped-event image and persist its storage URL. */
export async function rehostScrapedEventImage(
  eventId: string,
  sourceImageUrl: string | null | undefined,
  currentImageUrl?: string | null,
  currentSourceImageUrl?: string | null
): Promise<"updated" | "skipped" | "failed"> {
  if (!sourceImageUrl) {
    return "skipped";
  }

  if (isStorageUrl(currentImageUrl ?? sourceImageUrl)) {
    if (currentSourceImageUrl === sourceImageUrl) return "skipped";

    // Bootstrap tracking for images hosted before source_image_url existed.
    // Preserve updated_at because this is bookkeeping, not a visible change.
    if (!currentSourceImageUrl) {
      await db
        .update(events)
        .set({ sourceImageUrl })
        .where(eq(events.id, eventId));
      return "skipped";
    }
  }

  try {
    const hostedImageUrl = await uploadImageFromUrl(
      sourceImageUrl,
      `events/${eventId}/cover-images`,
      "cover-image.jpg"
    );
    await db
      .update(events)
      .set({
        coverImageUrl: hostedImageUrl,
        sourceImageUrl,
        updatedAt: new Date(),
      })
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
      sourceImageUrl: true,
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
        row.coverImageUrl,
        row.sourceImageUrl
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
