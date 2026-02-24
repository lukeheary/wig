import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, types } from "@neondatabase/serverless";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Treat Postgres "timestamp without time zone" as UTC.
// We store event times in UTC-like values and render in user-local time on the client.
types.setTypeParser(types.builtins.TIMESTAMP, (value: string) =>
  new Date(value.replace(" ", "T") + "Z")
);

// Create connection pool
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Initialize Drizzle with schema
export const db = drizzle(pool, { schema });
