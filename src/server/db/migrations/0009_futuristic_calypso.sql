CREATE TYPE "public"."activity_entity_type" AS ENUM('event', 'venue', 'organizer', 'user');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('rsvp_going', 'rsvp_interested', 'follow_venue', 'follow_organizer', 'created_event', 'checked_in');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text NOT NULL,
	"type" "activity_type" NOT NULL,
	"entity_type" "activity_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_actor_created_at_idx" ON "activity_events" USING btree ("actor_user_id","created_at");