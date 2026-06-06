-- Remove 'clubcafe' from scraper_type enum
-- Postgres doesn't support DROP VALUE, so we recreate the type

-- First delete any scrapers that use clubcafe
DELETE FROM "scrapers" WHERE "scraper" = 'clubcafe';

-- Create replacement enum without clubcafe
CREATE TYPE "public"."scraper_type_new" AS ENUM('dice', 'posh', 'ticketmaster');

-- Migrate the column
ALTER TABLE "scrapers" ALTER COLUMN "scraper" TYPE "public"."scraper_type_new" USING "scraper"::text::"public"."scraper_type_new";

-- Drop old, rename new
DROP TYPE "public"."scraper_type";
ALTER TYPE "public"."scraper_type_new" RENAME TO "scraper_type";

-- Create scraper_log_status enum
CREATE TYPE "public"."scraper_log_status" AS ENUM('success', 'error', 'partial');

-- Create scraper_logs table
CREATE TABLE "scraper_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scraper_id" uuid REFERENCES "scrapers"("id") ON DELETE SET NULL,
  "place_id" uuid REFERENCES "places"("id") ON DELETE SET NULL,
  "place_name" text NOT NULL,
  "scraper" "scraper_type" NOT NULL,
  "status" "scraper_log_status" NOT NULL,
  "events_found" integer DEFAULT 0 NOT NULL,
  "events_added" integer DEFAULT 0 NOT NULL,
  "duration_ms" integer,
  "error" text,
  "data" jsonb,
  "ran_at" timestamp DEFAULT now() NOT NULL
);
