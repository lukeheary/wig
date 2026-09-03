ALTER TABLE "user_promoted_events" ALTER COLUMN "promo" SET DATA TYPE varchar(70) USING left("promo", 70);
--> statement-breakpoint
ALTER TABLE "user_promoted_events" ADD COLUMN IF NOT EXISTS "promo_url" varchar(2048);
