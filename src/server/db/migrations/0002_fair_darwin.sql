ALTER TABLE "events" ALTER COLUMN "venue_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "address" text;