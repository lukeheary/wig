ALTER TABLE "user_activity"
ADD COLUMN "updated_at" timestamp;
--> statement-breakpoint
UPDATE "user_activity"
SET "updated_at" = "created_at"
WHERE "updated_at" IS NULL;
--> statement-breakpoint
WITH ranked_rsvp_activity AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "actor_user_id", "entity_type", "entity_id"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS rn
  FROM "user_activity"
  WHERE "type" IN ('rsvp_going', 'rsvp_interested', 'rsvp_not_going')
)
DELETE FROM "user_activity"
WHERE "id" IN (
  SELECT "id"
  FROM ranked_rsvp_activity
  WHERE rn > 1
);
--> statement-breakpoint
ALTER TABLE "user_activity"
ALTER COLUMN "updated_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "user_activity"
ALTER COLUMN "updated_at" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "activity_actor_updated_at_idx"
ON "user_activity" USING btree ("actor_user_id","updated_at");
