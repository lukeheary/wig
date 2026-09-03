ALTER TABLE "metro_areas" ADD COLUMN IF NOT EXISTS "is_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Preserve the currently launched markets when this migration is applied.
UPDATE "metro_areas"
SET "is_enabled" = true
WHERE lower("name") IN ('boston', 'chicago');
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "metro_area_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_metro_area_id_metro_areas_id_fk'
  ) THEN
    ALTER TABLE "users"
    ADD CONSTRAINT "users_metro_area_id_metro_areas_id_fk"
    FOREIGN KEY ("metro_area_id") REFERENCES "public"."metro_areas"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_metro_area_idx" ON "users" USING btree ("metro_area_id");
--> statement-breakpoint

-- Preserve an obvious selection for existing users in the two launched cities.
UPDATE "users" AS "user"
SET "metro_area_id" = "metro"."id"
FROM "metro_areas" AS "metro"
WHERE lower("user"."city") = lower("metro"."name")
  AND upper("user"."state") = upper("metro"."state")
  AND "metro"."is_enabled" = true;
