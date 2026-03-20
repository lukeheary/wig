CREATE TABLE "user_surface_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "surface" varchar(100) NOT NULL,
  "last_visited_at" timestamp,
  "missed_window_start_at" timestamp,
  "missed_window_expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_surface_state"
ADD CONSTRAINT "user_surface_state_user_id_users_id_fk"
FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_surface_state_user_surface_idx"
ON "user_surface_state" USING btree ("user_id","surface");
--> statement-breakpoint
CREATE INDEX "user_surface_state_user_updated_at_idx"
ON "user_surface_state" USING btree ("user_id","updated_at");
