CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other');--> statement-breakpoint
CREATE TYPE "public"."place_type" AS ENUM('venue', 'organizer');--> statement-breakpoint
CREATE TABLE "place_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"place_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"place_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "place_type" NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"image_url" text,
	"address" text,
	"city" varchar(100),
	"state" varchar(2),
	"latitude" double precision,
	"longitude" double precision,
	"website" text,
	"instagram" varchar(100),
	"hours" jsonb,
	"categories" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "places_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "organizerFollows" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizerMembers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "venueFollows" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "venueMembers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "venues" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "organizerFollows" CASCADE;--> statement-breakpoint
DROP TABLE "organizerMembers" CASCADE;--> statement-breakpoint
DROP TABLE "organizers" CASCADE;--> statement-breakpoint
DROP TABLE "venueFollows" CASCADE;--> statement-breakpoint
DROP TABLE "venueMembers" CASCADE;--> statement-breakpoint
DROP TABLE "venues" CASCADE;--> statement-breakpoint
ALTER TABLE "activity_events" RENAME TO "activity";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "category" TO "categories";--> statement-breakpoint
ALTER TABLE "activity" DROP CONSTRAINT "activity_events_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_venue_id_venues_id_fk";
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_organizer_id_organizers_id_fk";
--> statement-breakpoint
DROP INDEX "activity_events_actor_created_at_idx";--> statement-breakpoint
DROP INDEX "events_category_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" "gender";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_onboarding" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "place_follows" ADD CONSTRAINT "place_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_follows" ADD CONSTRAINT "place_follows_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_members" ADD CONSTRAINT "place_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_members" ADD CONSTRAINT "place_members_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "place_follows_user_place_idx" ON "place_follows" USING btree ("user_id","place_id");--> statement-breakpoint
CREATE INDEX "place_follows_user_idx" ON "place_follows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "place_follows_place_idx" ON "place_follows" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "place_members_user_place_idx" ON "place_members" USING btree ("user_id","place_id");--> statement-breakpoint
CREATE INDEX "place_members_user_idx" ON "place_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "place_members_place_idx" ON "place_members" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "places_slug_idx" ON "places" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "places_type_idx" ON "places" USING btree ("type");--> statement-breakpoint
CREATE INDEX "places_location_idx" ON "places" USING btree ("city","state");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_places_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_places_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_actor_created_at_idx" ON "activity" USING btree ("actor_user_id","created_at");--> statement-breakpoint
ALTER TABLE "public"."activity" ALTER COLUMN "entity_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."activity_entity_type";--> statement-breakpoint
CREATE TYPE "public"."activity_entity_type" AS ENUM('event', 'place', 'user');--> statement-breakpoint
ALTER TABLE "public"."activity" ALTER COLUMN "entity_type" SET DATA TYPE "public"."activity_entity_type" USING "entity_type"::"public"."activity_entity_type";--> statement-breakpoint
ALTER TABLE "public"."activity" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."activity_type";--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('rsvp_going', 'rsvp_interested', 'follow_place', 'created_event', 'checked_in');--> statement-breakpoint
ALTER TABLE "public"."activity" ALTER COLUMN "type" SET DATA TYPE "public"."activity_type" USING "type"::"public"."activity_type";--> statement-breakpoint
DROP TYPE "public"."event_category";