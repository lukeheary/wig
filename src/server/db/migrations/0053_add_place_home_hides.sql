CREATE TABLE "place_home_hides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"place_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "place_home_hides" ADD CONSTRAINT "place_home_hides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "place_home_hides" ADD CONSTRAINT "place_home_hides_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "place_home_hides_user_place_idx" ON "place_home_hides" USING btree ("user_id","place_id");
--> statement-breakpoint
CREATE INDEX "place_home_hides_user_idx" ON "place_home_hides" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "place_home_hides_place_idx" ON "place_home_hides" USING btree ("place_id");
