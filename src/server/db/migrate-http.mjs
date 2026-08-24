import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

dotenv.config({ path: ".env.local" });

const configuredDatabaseUrl =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!configuredDatabaseUrl) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const migrationUrl = new URL(configuredDatabaseUrl);
// App traffic uses Neon's pooled hostname, but schema migrations need a direct
// connection. Neon direct and pooled endpoints share credentials and differ by
// the `-pooler` hostname suffix.
migrationUrl.hostname = migrationUrl.hostname.replace("-pooler.", ".");

console.log("🔌 Connecting to Neon over HTTP...");

const sql = neon(migrationUrl.toString());
const db = drizzle(sql);

await sql("select 1");

console.log("🚀 Applying pending migrations...");
await migrate(db, { migrationsFolder: "./src/server/db/migrations" });

console.log("✅ Migrations complete!");
