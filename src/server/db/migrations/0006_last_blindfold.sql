CREATE TABLE "organizerFollows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organizer_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizerMembers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organizer_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"image_url" text,
	"website" text,
	"instagram" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "venueFollows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"venue_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venueMembers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"venue_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"image_url" text,
	"address" text,
	"city" varchar(100) NOT NULL,
	"state" varchar(2) NOT NULL,
	"website" text,
	"instagram" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "venue_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "organizer_id" uuid;--> statement-breakpoint
ALTER TABLE "organizerFollows" ADD CONSTRAINT "organizerFollows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizerFollows" ADD CONSTRAINT "organizerFollows_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizerMembers" ADD CONSTRAINT "organizerMembers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizerMembers" ADD CONSTRAINT "organizerMembers_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venueFollows" ADD CONSTRAINT "venueFollows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venueFollows" ADD CONSTRAINT "venueFollows_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venueMembers" ADD CONSTRAINT "venueMembers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venueMembers" ADD CONSTRAINT "venueMembers_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organizerFollows_user_organizer_idx" ON "organizerFollows" USING btree ("user_id","organizer_id");--> statement-breakpoint
CREATE INDEX "organizerFollows_user_idx" ON "organizerFollows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organizerFollows_organizer_idx" ON "organizerFollows" USING btree ("organizer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizerMembers_user_organizer_idx" ON "organizerMembers" USING btree ("user_id","organizer_id");--> statement-breakpoint
CREATE INDEX "organizerMembers_user_idx" ON "organizerMembers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organizerMembers_organizer_idx" ON "organizerMembers" USING btree ("organizer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizers_slug_idx" ON "organizers" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "venueFollows_user_venue_idx" ON "venueFollows" USING btree ("user_id","venue_id");--> statement-breakpoint
CREATE INDEX "venueFollows_user_idx" ON "venueFollows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "venueFollows_venue_idx" ON "venueFollows" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venueMembers_user_venue_idx" ON "venueMembers" USING btree ("user_id","venue_id");--> statement-breakpoint
CREATE INDEX "venueMembers_user_idx" ON "venueMembers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "venueMembers_venue_idx" ON "venueMembers" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_slug_idx" ON "venues" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "venues_location_idx" ON "venues" USING btree ("city","state");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_venue_idx" ON "events" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "events_organizer_idx" ON "events" USING btree ("organizer_id");