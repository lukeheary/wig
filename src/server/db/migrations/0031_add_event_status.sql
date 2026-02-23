CREATE TYPE "public"."event_status" AS ENUM('active', 'cancelled', 'postponed', 'draft');--> statement-breakpoint
ALTER TABLE "event_series" ADD COLUMN "status" "event_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "status" "event_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE INDEX "events_status_idx" ON "events" USING btree ("status");
