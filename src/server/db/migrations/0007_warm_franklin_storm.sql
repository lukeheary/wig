ALTER TABLE "businesses" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "businesses" CASCADE;--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_business_id_businesses_id_fk";
--> statement-breakpoint
ALTER TABLE "follows" DROP CONSTRAINT "follows_business_id_businesses_id_fk";
--> statement-breakpoint
DROP INDEX "events_business_idx";--> statement-breakpoint
DROP INDEX "follows_user_business_idx";--> statement-breakpoint
DROP INDEX "follows_business_idx";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "business_id";--> statement-breakpoint
ALTER TABLE "follows" DROP COLUMN "business_id";