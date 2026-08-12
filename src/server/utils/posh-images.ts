import { and, eq, like } from "drizzle-orm";
import { uploadImageFromUrl } from "@/lib/s3";
import { db } from "@/server/db";
import { events } from "@/server/db/schema";

const POSH_IMAGE_PREFIX = "https://images.posh.vip/";
const REHOST_CONCURRENCY = 4;

/**
 * Repair existing WIG events that still depend on Posh-hosted cover images.
 * This deliberately queries WIG rather than relying on the current scraper
 * response, because Posh may stop returning events after they end.
 */
export async function rehostExistingPoshEventImages(): Promise<{
  found: number;
  updated: number;
  failed: number;
}> {
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.source, "posh"),
      like(events.coverImageUrl, `${POSH_IMAGE_PREFIX}%`)
    ),
    columns: {
      id: true,
      coverImageUrl: true,
    },
  });

  let updated = 0;
  let failed = 0;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < rows.length) {
      const row = rows[nextIndex++];
      if (!row?.coverImageUrl) continue;

      try {
        const hostedImageUrl = await uploadImageFromUrl(
          row.coverImageUrl,
          `events/${row.id}`,
          "cover-image.png"
        );
        await db
          .update(events)
          .set({ coverImageUrl: hostedImageUrl, updatedAt: new Date() })
          .where(eq(events.id, row.id));
        updated += 1;
      } catch (error) {
        failed += 1;
        console.error(`Failed to re-host Posh image for event ${row.id}`, error);
      }
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
