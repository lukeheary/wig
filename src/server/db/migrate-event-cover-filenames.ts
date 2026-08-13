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

  // Storage helpers determine the physical object prefix from NODE_ENV.
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
  const legacyRows = await db.query.events.findMany({
    where: like(schema.events.coverImageUrl, "%/coverImage.png"),
    columns: { id: true, coverImageUrl: true },
  });

  console.log(
    `${apply ? "Migrating" : "Dry run:"} ${legacyRows.length} event cover image${legacyRows.length === 1 ? "" : "s"} in ${environment}`
  );

  if (!apply) {
    for (const row of legacyRows) {
      const currentKey = row.coverImageUrl
        ? storageUrls.normalizeStoredImageValue(row.coverImageUrl)
        : "";
      console.log(
        `${row.id}: ${currentKey} -> ${currentKey.replace(/coverImage\.png$/, "cover-image.png")}`
      );
    }
    console.log("No changes made. Re-run with --apply to perform the migration.");
    return;
  }

  let migrated = 0;
  let failed = 0;

  for (const row of legacyRows) {
    if (!row.coverImageUrl) continue;

    try {
      const currentKey = storageUrls.normalizeStoredImageValue(row.coverImageUrl);
      const targetKey = currentKey.replace(/coverImage\.png$/, "cover-image.png");
      if (targetKey === currentKey) continue;

      const separator = targetKey.lastIndexOf("/");
      const targetFolder = targetKey.slice(0, separator);
      const targetFileName = targetKey.slice(separator + 1);

      const newUrl = await storage.copyStorageObject(
        row.coverImageUrl,
        targetFolder,
        targetFileName
      );

      await db
        .update(schema.events)
        .set({ coverImageUrl: newUrl })
        .where(eq(schema.events.id, row.id));

      // Delete only after both copies and the database update succeed.
      await storage.deleteFromS3(row.coverImageUrl);
      migrated += 1;
      console.log(`Migrated ${row.id}: ${currentKey} -> ${targetKey}`);
    } catch (error) {
      failed += 1;
      console.error(`Failed to migrate ${row.id}`, error);
    }
  }

  console.log(`Complete: ${migrated} migrated, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Failed to migrate event cover filenames:", error);
  process.exitCode = 1;
});
