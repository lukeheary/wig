import * as dotenv from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { isNull } from "drizzle-orm";
import ws from "ws";
import { events, eventSeries } from "./schema";

dotenv.config({ path: ".env.local" });

neonConfig.webSocketConstructor = ws;

const EASTERN_TIME_ZONE = "America/New_York";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const updatedEvents = await db
    .update(events)
    .set({ timeZone: EASTERN_TIME_ZONE })
    .where(isNull(events.timeZone))
    .returning({ id: events.id });

  const updatedSeries = await db
    .update(eventSeries)
    .set({ timeZone: EASTERN_TIME_ZONE })
    .where(isNull(eventSeries.timeZone))
    .returning({ id: eventSeries.id });

  console.log(
    `Backfilled ${updatedEvents.length} events and ${updatedSeries.length} event series to ${EASTERN_TIME_ZONE}.`
  );

  await pool.end();
}

main().catch((error) => {
  console.error("Failed to backfill event time zones:", error);
  process.exit(1);
});
