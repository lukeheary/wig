ALTER TABLE "event_reviews" ALTER COLUMN "rating" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "event_reviews" ADD COLUMN "skipped_at" timestamp;
