DROP INDEX IF EXISTS "scrapers_place_idx";

CREATE INDEX "scrapers_place_idx" ON "scrapers" USING btree ("place_id");
