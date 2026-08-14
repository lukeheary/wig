import { eq, or } from "drizzle-orm";
import { deleteFromS3, isStorageUrl } from "@/lib/s3";
import { eventSeries, events, places, users } from "@/server/db/schema";

type ImageReplacement = {
  oldUrl: string | null | undefined;
  newUrl: string | null | undefined;
};

async function isReferenced(db: any, url: string): Promise<boolean> {
  const [event, series, place, user] = await Promise.all([
    db.query.events.findFirst({
      where: eq(events.coverImageUrl, url),
      columns: { id: true },
    }),
    db.query.eventSeries.findFirst({
      where: eq(eventSeries.coverImageUrl, url),
      columns: { id: true },
    }),
    db.query.places.findFirst({
      where: or(eq(places.logoImageUrl, url), eq(places.coverImageUrl, url)),
      columns: { id: true },
    }),
    db.query.users.findFirst({
      where: eq(users.avatarImageUrl, url),
      columns: { id: true },
    }),
  ]);
  return Boolean(event || series || place || user);
}

async function deleteIfUnreferenced(db: any, url: string | null | undefined) {
  if (!url || !isStorageUrl(url) || (await isReferenced(db, url))) return;
  await deleteFromS3(url);
}

/**
 * Persist image reference changes with best-effort storage rollback/cleanup.
 * Database success is authoritative; storage deletion failures are only logged.
 */
export async function withStoredImageReplacements<T>({
  db,
  replacements,
  persist,
}: {
  db: any;
  replacements: ImageReplacement[];
  persist: () => Promise<T>;
}): Promise<T> {
  const changed = replacements.filter(
    ({ oldUrl, newUrl }) => oldUrl !== newUrl
  );

  let result: T;
  try {
    result = await persist();
  } catch (error) {
    await Promise.allSettled(
      changed.map(({ newUrl }) => deleteIfUnreferenced(db, newUrl))
    );
    throw error;
  }

  const cleanupResults = await Promise.allSettled(
    changed.map(({ oldUrl }) => deleteIfUnreferenced(db, oldUrl))
  );
  for (const cleanup of cleanupResults) {
    if (cleanup.status === "rejected") {
      console.error("Failed to clean up replaced image", cleanup.reason);
    }
  }

  return result;
}
