import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "@/server/db/schema";

// Scheduled imports have a separate small pool and finite database waits.
// The normal app/legacy pool and its behavior stay unchanged.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
  statement_timeout: 10_000,
  idleTimeoutMillis: 30_000,
});
export const batchDb = drizzle(pool, { schema });
