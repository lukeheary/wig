import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import ws from "ws";
import { readMigrationFiles } from "drizzle-orm/migrator";

// Load environment variables
dotenv.config({ path: ".env.local" });

// Configure WebSocket for Node.js environment
neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

type MigrationRow = {
  hash: string;
  folderMillis: number;
};

function buildMonotonicMigrationTimeline(migrations: MigrationRow[]) {
  let lastAppliedAt = 0;

  return migrations.map((migration) => {
    lastAppliedAt = Math.max(migration.folderMillis, lastAppliedAt + 1);

    return {
      ...migration,
      appliedAt: lastAppliedAt,
    };
  });
}

async function bootstrapLegacyMigrationHistory(pool: Pool) {
  const migrations = buildMonotonicMigrationTimeline(
    readMigrationFiles({
      migrationsFolder: "./src/server/db/migrations",
    })
  );

  const migrationTableExists = await pool.query<{
    exists: boolean;
  }>(
    `select exists (
      select 1
      from information_schema.tables
      where table_schema = 'drizzle'
        and table_name = '__drizzle_migrations'
    )`
  );

  if (migrationTableExists.rows[0]?.exists) {
    for (const migration of migrations) {
      await pool.query(
        `update "drizzle"."__drizzle_migrations"
         set "created_at" = $2
         where "hash" = $1`,
        [migration.hash, migration.appliedAt]
      );
    }

    return false;
  }

  const schemaMarkers = await pool.query<{
    hasEventVisibilityType: boolean;
    hasSeriesTimeZone: boolean;
    hasEventTimeZone: boolean;
    hasUnaccent: boolean;
  }>(
    `select
      exists (select 1 from pg_type where typname = 'event_visibility') as "hasEventVisibilityType",
      exists (select 1 from information_schema.columns where table_name = 'event_series' and column_name = 'time_zone') as "hasSeriesTimeZone",
      exists (select 1 from information_schema.columns where table_name = 'events' and column_name = 'time_zone') as "hasEventTimeZone",
      exists (select 1 from pg_extension where extname = 'unaccent') as "hasUnaccent"`
  );

  const markers = schemaMarkers.rows[0];
  const looksLikeLegacyInitializedDb =
    markers?.hasEventVisibilityType &&
    markers.hasSeriesTimeZone &&
    markers.hasEventTimeZone;

  if (!looksLikeLegacyInitializedDb) {
    return false;
  }

  let baselineCount = 0;

  if (markers.hasUnaccent) {
    baselineCount = migrations.length;
  } else {
    baselineCount = migrations.findIndex(
      (migration) =>
        migration.hash ===
        "3e0d6ef85217a64f0e9445f924c684a9b2aa5ebeea629e2827394b9d5c82ab24"
    );

    if (baselineCount === -1) {
      throw new Error("Could not locate the unaccent migration in local history");
    }
  }

  console.log(
    `ℹ️  Bootstrapping Drizzle migration history with ${baselineCount} existing migrations...`
  );

  await pool.query(`
    create schema if not exists "drizzle"
  `);

  await pool.query(`
    create table if not exists "drizzle"."__drizzle_migrations" (
      id serial primary key,
      hash text not null,
      created_at numeric
    )
  `);

  for (const migration of migrations.slice(0, baselineCount)) {
    await pool.query(
      `insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
       values ($1, $2)`,
      [migration.hash, migration.appliedAt]
    );
  }

  return true;
}

async function runMigrations() {
  console.log("⏳ Running migrations...");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool);

  await bootstrapLegacyMigrationHistory(pool);
  await migrate(db, {
    migrationsFolder: "./src/server/db/migrations",
    migrationsSchema: "drizzle",
  });

  console.log("✅ Migrations complete!");
  await pool.end();
  process.exit(0);
}

runMigrations().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
