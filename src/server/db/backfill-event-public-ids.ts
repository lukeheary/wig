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

async function withCollisionRetry(update: (publicId: string) => Promise<void>) {
  const { generateNanoId } = await import("@/lib/nano-id");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await update(generateNanoId());
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== "23505" || attempt === 4) {
        throw error;
      }
    }
  }
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

  const [{ neon }, { drizzle }, { eq, isNull }, schema] = await Promise.all([
    import("@neondatabase/serverless"),
    import("drizzle-orm/neon-http"),
    import("drizzle-orm"),
    import("./schema"),
  ]);

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });
  const [eventRows, seriesRows] = await Promise.all([
    db.query.events.findMany({
      where: isNull(schema.events.publicId),
      columns: { id: true },
    }),
    db.query.eventSeries.findMany({
      where: isNull(schema.eventSeries.publicId),
      columns: { id: true },
    }),
  ]);

  console.log(
    `${apply ? "Backfilling" : "Dry run:"} ${eventRows.length} events and ${seriesRows.length} event series in ${environment}`
  );
  if (!apply) {
    console.log(
      "No changes made. Re-run with --apply to backfill and enforce NOT NULL."
    );
    return;
  }

  let updatedEvents = 0;
  let updatedSeries = 0;
  for (const event of eventRows) {
    await withCollisionRetry(async (publicId) => {
      await db
        .update(schema.events)
        .set({ publicId })
        .where(eq(schema.events.id, event.id));
    });
    updatedEvents += 1;
  }
  for (const series of seriesRows) {
    await withCollisionRetry(async (publicId) => {
      await db
        .update(schema.eventSeries)
        .set({ publicId })
        .where(eq(schema.eventSeries.id, series.id));
    });
    updatedSeries += 1;
  }

  const [remainingEvents, remainingSeries] = await Promise.all([
    db.query.events.findMany({
      where: isNull(schema.events.publicId),
      columns: { id: true },
      limit: 1,
    }),
    db.query.eventSeries.findMany({
      where: isNull(schema.eventSeries.publicId),
      columns: { id: true },
      limit: 1,
    }),
  ]);
  if (remainingEvents.length > 0 || remainingSeries.length > 0) {
    throw new Error(
      "Public ID backfill is incomplete; NOT NULL was not applied"
    );
  }

  await sql`ALTER TABLE "events" ALTER COLUMN "public_id" SET NOT NULL`;
  await sql`ALTER TABLE "event_series" ALTER COLUMN "public_id" SET NOT NULL`;
  console.log(
    `Complete: ${updatedEvents} events and ${updatedSeries} event series backfilled; public_id is now NOT NULL.`
  );
}

main().catch((error) => {
  console.error("Failed to backfill event public IDs:", error);
  process.exitCode = 1;
});
