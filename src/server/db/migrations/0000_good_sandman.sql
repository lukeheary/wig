CREATE TYPE "public"."event_category" AS ENUM('music', 'food', 'art', 'sports', 'community', 'nightlife', 'other');--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."friend_status" AS ENUM('pending', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."rsvp_status" AS ENUM('going', 'interested', 'not_going');--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"city" varchar(100) NOT NULL,
	"state" varchar(2) NOT NULL,
	"website" text,
	"instagram" varchar(100),
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"created_by_user_id" text NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp,
	"venue_name" varchar(255) NOT NULL,
	"address" text NOT NULL,
	"city" varchar(100) NOT NULL,
	"state" varchar(2) NOT NULL,
	"category" "event_category" DEFAULT 'other' NOT NULL,
	"visibility" "event_visibility" DEFAULT 'public' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"business_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"friend_user_id" text NOT NULL,
	"status" "friend_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"status" "rsvp_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"image_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends" ADD CONSTRAINT "friends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends" ADD CONSTRAINT "friends_friend_user_id_users_id_fk" FOREIGN KEY ("friend_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_slug_idx" ON "businesses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "businesses_location_idx" ON "businesses" USING btree ("city","state");--> statement-breakpoint
CREATE INDEX "businesses_created_by_idx" ON "businesses" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "events_business_idx" ON "events" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "events_start_at_idx" ON "events" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "events_location_idx" ON "events" USING btree ("city","state");--> statement-breakpoint
CREATE INDEX "events_category_idx" ON "events" USING btree ("category");--> statement-breakpoint
CREATE INDEX "events_visibility_idx" ON "events" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "events_start_visibility_idx" ON "events" USING btree ("start_at","visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "follows_user_business_idx" ON "follows" USING btree ("user_id","business_id");--> statement-breakpoint
CREATE INDEX "follows_user_idx" ON "follows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "follows_business_idx" ON "follows" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friends_user_friend_idx" ON "friends" USING btree ("user_id","friend_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friends_friend_user_idx" ON "friends" USING btree ("friend_user_id","user_id");--> statement-breakpoint
CREATE INDEX "friends_user_status_idx" ON "friends" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "friends_friend_user_status_idx" ON "friends" USING btree ("friend_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rsvps_user_event_idx" ON "rsvps" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "rsvps_event_status_idx" ON "rsvps" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "rsvps_user_idx" ON "rsvps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");