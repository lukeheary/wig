CREATE TYPE "scraper_type" AS ENUM ('dice', 'posh', 'clubcafe', 'ticketmaster');
--> statement-breakpoint
CREATE TABLE "scrapers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" uuid NOT NULL,
	"scraper" "scraper_type" NOT NULL,
	"search_string" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scrapers_place_idx" ON "scrapers" USING btree ("place_id");
--> statement-breakpoint
CREATE INDEX "scrapers_scraper_idx" ON "scrapers" USING btree ("scraper");
--> statement-breakpoint
ALTER TABLE "scrapers" ADD CONSTRAINT "scrapers_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;
