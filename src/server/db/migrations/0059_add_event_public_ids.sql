ALTER TABLE "events" ADD COLUMN "public_id" varchar(20);
--> statement-breakpoint
ALTER TABLE "event_series" ADD COLUMN "public_id" varchar(20);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_public_id_unique" UNIQUE("public_id");
--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_public_id_unique" UNIQUE("public_id");
