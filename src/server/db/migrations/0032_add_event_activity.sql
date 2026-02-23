CREATE TYPE "public"."event_activity_type" AS ENUM(
  'created',
  'updated',
  'cancelled',
  'postponed',
  'rescheduled',
  'restored'
);--> statement-breakpoint

CREATE TABLE "event_activity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" text NOT NULL,
  "event_id" uuid NOT NULL,
  "type" "event_activity_type" NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "event_activity"
ADD CONSTRAINT "event_activity_actor_user_id_users_id_fk"
FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "event_activity"
ADD CONSTRAINT "event_activity_event_id_events_id_fk"
FOREIGN KEY ("event_id") REFERENCES "public"."events"("id")
ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "event_activity_actor_created_at_idx"
ON "event_activity" USING btree ("actor_user_id","created_at");--> statement-breakpoint

CREATE INDEX "event_activity_event_created_at_idx"
ON "event_activity" USING btree ("event_id","created_at");
