ALTER TABLE "scrapers"
  ADD COLUMN "next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "last_attempt_at" timestamp with time zone,
  ADD COLUMN "last_success_at" timestamp with time zone,
  ADD COLUMN "attempts_since_success" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX "scrapers_next_run_idx" ON "scrapers" ("next_run_at", "id");
--> statement-breakpoint
CREATE TABLE "scraper_runner_lock" (
  "id" text PRIMARY KEY,
  "token" uuid NOT NULL,
  "locked_until" timestamp with time zone NOT NULL,
  "cooldowns" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "scraper_logs_ran_at_idx" ON "scraper_logs" ("ran_at");
--> statement-breakpoint
CREATE INDEX "scraper_logs_scraper_ran_at_idx" ON "scraper_logs" ("scraper_id", "ran_at");
