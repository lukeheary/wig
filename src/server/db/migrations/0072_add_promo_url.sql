ALTER TABLE "user_promoted_events" ALTER COLUMN "promo" SET DATA TYPE varchar(70) USING left("promo", 70);
ALTER TABLE "user_promoted_events" ADD COLUMN "promo_url" varchar(2048);