UPDATE "events"
SET "time_zone" = 'America/New_York'
WHERE "time_zone" IS NULL;

UPDATE "event_series"
SET "time_zone" = 'America/New_York'
WHERE "time_zone" IS NULL;
