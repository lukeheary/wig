import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

function argumentValue(name: string): string | undefined {
  const inline = process.argv.find((argument) =>
    argument.startsWith(`--${name}=`)
  );
  if (inline) return inline.slice(inline.indexOf("=") + 1);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
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

  const [{ neon }, { drizzle }, { like, eq }, schema, storage, storageUrls] =
    await Promise.all([
      import("@neondatabase/serverless"),
      import("drizzle-orm/neon-http"),
      import("drizzle-orm"),
      import("./schema"),
      import("@/lib/s3"),
      import("@/lib/storage-url"),
    ]);

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });
  const [eventRows, seriesRows] = await Promise.all([
    db.query.events.findMany({
      where: like(schema.events.coverImageUrl, "%.png"),
      columns: { coverImageUrl: true },
    }),
    db.query.eventSeries.findMany({
      where: like(schema.eventSeries.coverImageUrl, "%.png"),
      columns: { coverImageUrl: true },
    }),
  ]);

  const sourceUrls = new Set(
    [...eventRows, ...seriesRows]
      .map((row) => row.coverImageUrl)
      .filter(
        (url): url is string => Boolean(url) && storage.isStorageUrl(url!)
      )
  );

  console.log(
    `${apply ? "Migrating" : "Dry run:"} ${sourceUrls.size} unique event cover image${sourceUrls.size === 1 ? "" : "s"} in ${environment}`
  );

  if (!apply) {
    for (const sourceUrl of sourceUrls) {
      const currentKey = storageUrls.normalizeStoredImageValue(sourceUrl);
      console.log(`${currentKey} -> ${currentKey.replace(/\.png$/i, ".jpg")}`);
    }
    console.log(
      "No changes made. Re-run with --apply to perform the migration."
    );
    return;
  }

  let migrated = 0;
  let failed = 0;

  for (const sourceUrl of sourceUrls) {
    try {
      const currentKey = storageUrls.normalizeStoredImageValue(sourceUrl);
      const targetKey = currentKey.replace(/\.png$/i, ".jpg");
      if (targetKey === currentKey) continue;

      const separator = targetKey.lastIndexOf("/");
      const targetFolder = targetKey.slice(0, separator);
      const targetFileName = targetKey.slice(separator + 1);
      const newUrl = await storage.convertStorageImageToJpeg(
        sourceUrl,
        targetFolder,
        targetFileName
      );

      // A series image may be shared by every generated occurrence. Update all
      // references before deleting the source object.
      await Promise.all([
        db
          .update(schema.events)
          .set({ coverImageUrl: newUrl })
          .where(eq(schema.events.coverImageUrl, sourceUrl)),
        db
          .update(schema.eventSeries)
          .set({ coverImageUrl: newUrl })
          .where(eq(schema.eventSeries.coverImageUrl, sourceUrl)),
      ]);

      await storage.deleteFromS3(sourceUrl);
      migrated += 1;
      console.log(`Migrated ${currentKey} -> ${targetKey}`);
    } catch (error) {
      failed += 1;
      console.error(`Failed to migrate ${sourceUrl}`, error);
    }
  }

  console.log(`Complete: ${migrated} migrated, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Failed to migrate event covers to JPEG:", error);
  process.exitCode = 1;
});
