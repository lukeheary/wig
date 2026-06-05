ALTER TABLE "events" ADD COLUMN "time_zone" varchar(64);

UPDATE "events"
SET "time_zone" = "event_series"."time_zone"
FROM "event_series"
WHERE "events"."series_id" = "event_series"."id"
  AND "events"."time_zone" IS NULL
  AND "event_series"."time_zone" IS NOT NULL;
