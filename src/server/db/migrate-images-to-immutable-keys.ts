import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

type ImageKind = "event" | "event-series" | "place-logo" | "user-avatar";

type MigrationTask = {
  kind: ImageKind;
  id: string;
  sourceUrl: string;
  sourceKey: string;
  targetFolder: string;
  targetFileName: string;
  cleanOnly: boolean;
  inheritedEventIds?: string[];
};

function argumentValue(name: string): string | undefined {
  const inline = process.argv.find((argument) =>
    argument.startsWith(`--${name}=`)
  );
  if (inline) return inline.slice(inline.indexOf("=") + 1);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasQuery(url: string): boolean {
  try {
    return new URL(url).search.length > 0;
  } catch {
    return url.includes("?");
  }
}

function isImmutableKey(kind: ImageKind, id: string, key: string): boolean {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const roots: Record<ImageKind, string> = {
    event: `events/${escapedId}/cover-images`,
    "event-series": `event-series/${escapedId}/cover-images`,
    "place-logo": `places/${escapedId}/logos`,
    "user-avatar": `users/${escapedId}/avatars`,
  };
  const extension = kind === "place-logo" ? "png" : "jpg";
  return new RegExp(`^${roots[kind]}/[A-Za-z0-9]{20}\\.${extension}$`).test(
    key
  );
}

async function main() {
  const environment = argumentValue("environment");
  const apply = process.argv.includes("--apply");

  if (environment !== "production" && environment !== "development") {
    throw new Error(
      "Pass --environment production or --environment development"
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  Object.assign(process.env, { NODE_ENV: environment });

  const [{ neon }, { drizzle }, { eq }, schema, storage, storageUrls, nanoIds] =
    await Promise.all([
      import("@neondatabase/serverless"),
      import("drizzle-orm/neon-http"),
      import("drizzle-orm"),
      import("./schema"),
      import("@/lib/s3"),
      import("@/lib/storage-url"),
      import("@/lib/nano-id"),
    ]);

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });
  const [eventRows, seriesRows, placeRows, userRows] = await Promise.all([
    db.query.events.findMany({
      columns: {
        id: true,
        seriesId: true,
        coverImageUrl: true,
        sourceImageUrl: true,
      },
    }),
    db.query.eventSeries.findMany({
      columns: { id: true, coverImageUrl: true },
    }),
    db.query.places.findMany({
      columns: { id: true, logoImageUrl: true, coverImageUrl: true },
    }),
    db.query.users.findMany({
      columns: { id: true, avatarImageUrl: true },
    }),
  ]);

  const storageKey = (url: string | null | undefined) =>
    url && storage.isStorageUrl(url)
      ? storageUrls.normalizeStoredImageValue(url)
      : null;
  const tasks: MigrationTask[] = [];
  const assignedEventIds = new Set<string>();

  // Series-owned images stay shared by occurrences that currently inherit the
  // exact same object. Per-occurrence overrides are handled as event images.
  for (const series of seriesRows) {
    const sourceKey = storageKey(series.coverImageUrl);
    if (!sourceKey || !series.coverImageUrl) continue;
    const inheritedEvents = eventRows.filter(
      (event) =>
        event.seriesId === series.id &&
        storageKey(event.coverImageUrl) === sourceKey
    );
    const inheritedEventIds = inheritedEvents.map((event) => event.id);
    inheritedEventIds.forEach((id) => assignedEventIds.add(id));
    const cleanOnly = isImmutableKey("event-series", series.id, sourceKey);
    const inheritedEventHasQuery = inheritedEvents.some(
      (event) => event.coverImageUrl && hasQuery(event.coverImageUrl)
    );
    if (
      cleanOnly &&
      !hasQuery(series.coverImageUrl) &&
      !inheritedEventHasQuery
    ) {
      continue;
    }

    tasks.push({
      kind: "event-series",
      id: series.id,
      sourceUrl: series.coverImageUrl,
      sourceKey,
      targetFolder: `event-series/${series.id}/cover-images`,
      targetFileName: `${nanoIds.generateNanoId()}.jpg`,
      cleanOnly,
      inheritedEventIds,
    });
  }

  for (const event of eventRows) {
    if (assignedEventIds.has(event.id)) continue;
    const sourceKey = storageKey(event.coverImageUrl);
    if (!sourceKey || !event.coverImageUrl) continue;
    const cleanOnly = isImmutableKey("event", event.id, sourceKey);
    if (cleanOnly && !hasQuery(event.coverImageUrl)) continue;

    tasks.push({
      kind: "event",
      id: event.id,
      sourceUrl: event.coverImageUrl,
      sourceKey,
      targetFolder: `events/${event.id}/cover-images`,
      targetFileName: `${nanoIds.generateNanoId()}.jpg`,
      cleanOnly,
    });
  }

  for (const place of placeRows) {
    const sourceKey = storageKey(place.logoImageUrl);
    if (!sourceKey || !place.logoImageUrl) continue;
    const cleanOnly = isImmutableKey("place-logo", place.id, sourceKey);
    if (cleanOnly && !hasQuery(place.logoImageUrl)) continue;

    tasks.push({
      kind: "place-logo",
      id: place.id,
      sourceUrl: place.logoImageUrl,
      sourceKey,
      targetFolder: `places/${place.id}/logos`,
      targetFileName: `${nanoIds.generateNanoId()}.png`,
      cleanOnly,
    });
  }

  for (const user of userRows) {
    const sourceKey = storageKey(user.avatarImageUrl);
    if (!sourceKey || !user.avatarImageUrl) continue;
    const cleanOnly = isImmutableKey("user-avatar", user.id, sourceKey);
    if (cleanOnly && !hasQuery(user.avatarImageUrl)) continue;

    tasks.push({
      kind: "user-avatar",
      id: user.id,
      sourceUrl: user.avatarImageUrl,
      sourceKey,
      targetFolder: `users/${user.id}/avatars`,
      targetFileName: `${nanoIds.generateNanoId()}.jpg`,
      cleanOnly,
    });
  }

  console.log(
    `${apply ? "Migrating" : "Dry run:"} ${tasks.length} image record${tasks.length === 1 ? "" : "s"} in ${environment}`
  );
  for (const task of tasks) {
    const target = task.cleanOnly
      ? `${task.sourceKey} (remove query parameters)`
      : `${task.targetFolder}/${task.targetFileName}`;
    console.log(`${task.kind} ${task.id}: ${task.sourceKey} -> ${target}`);
  }
  if (!apply) {
    console.log(
      "No changes made. Re-run with --apply to perform the migration."
    );
    return;
  }

  const sourceProgress = new Map<
    string,
    { total: number; succeeded: number; sourceUrl: string; moved: boolean }
  >();
  for (const task of tasks) {
    const progress = sourceProgress.get(task.sourceKey) ?? {
      total: 0,
      succeeded: 0,
      sourceUrl: task.sourceUrl,
      moved: false,
    };
    progress.total += 1;
    sourceProgress.set(task.sourceKey, progress);
  }

  let migrated = 0;
  let failed = 0;
  for (const task of tasks) {
    try {
      const nextUrl = task.cleanOnly
        ? storageUrls.resolveStoredImageValue(task.sourceKey)
        : task.kind === "place-logo"
          ? await storage.convertStorageImageToPng(
              task.sourceUrl,
              task.targetFolder,
              task.targetFileName
            )
          : await storage.convertStorageImageToJpeg(
              task.sourceUrl,
              task.targetFolder,
              task.targetFileName
            );

      if (task.kind === "event") {
        await db
          .update(schema.events)
          .set({ coverImageUrl: nextUrl })
          .where(eq(schema.events.id, task.id));
      } else if (task.kind === "event-series") {
        await db
          .update(schema.eventSeries)
          .set({ coverImageUrl: nextUrl })
          .where(eq(schema.eventSeries.id, task.id));
        for (const eventId of task.inheritedEventIds ?? []) {
          await db
            .update(schema.events)
            .set({ coverImageUrl: nextUrl })
            .where(eq(schema.events.id, eventId));
        }
      } else if (task.kind === "place-logo") {
        await db
          .update(schema.places)
          .set({ logoImageUrl: nextUrl })
          .where(eq(schema.places.id, task.id));
      } else {
        await db
          .update(schema.users)
          .set({ avatarImageUrl: nextUrl })
          .where(eq(schema.users.id, task.id));
      }

      const progress = sourceProgress.get(task.sourceKey)!;
      progress.succeeded += 1;
      progress.moved ||= !task.cleanOnly;
      migrated += 1;
      console.log(`Migrated ${task.kind} ${task.id}`);
    } catch (error) {
      failed += 1;
      console.error(`Failed to migrate ${task.kind} ${task.id}`, error);
    }
  }

  // These fields are intentionally outside this migration. Never delete an
  // object if one of them still references it.
  const protectedSourceKeys = new Set(
    [
      ...placeRows.map((place) => storageKey(place.coverImageUrl)),
      ...eventRows.map((event) => storageKey(event.sourceImageUrl)),
    ].filter((key): key is string => Boolean(key))
  );

  let deleted = 0;
  for (const [sourceKey, progress] of sourceProgress) {
    if (
      !progress.moved ||
      progress.succeeded !== progress.total ||
      protectedSourceKeys.has(sourceKey)
    ) {
      continue;
    }

    try {
      await storage.deleteFromS3(progress.sourceUrl);
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error(`Failed to delete old object ${sourceKey}`, error);
    }
  }

  console.log(
    `Complete: ${migrated} records migrated, ${deleted} old objects deleted, ${failed} failures.`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Failed to migrate images to immutable keys:", error);
  process.exitCode = 1;
});
