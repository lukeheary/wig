import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

dotenv.config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

console.log("🔌 Connecting to Neon over HTTP...");

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql);

await sql("select 1");

console.log("🚀 Applying pending migrations...");
await migrate(db, { migrationsFolder: "./src/server/db/migrations" });

console.log("✅ Migrations complete!");
