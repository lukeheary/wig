ALTER TABLE "places" ADD COLUMN "is_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE INDEX "places_enabled_idx" ON "places" USING btree ("is_enabled");
