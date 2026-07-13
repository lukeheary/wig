CREATE TYPE "event_review_rating" AS ENUM('loved_it', 'liked_it', 'okay', 'did_not_like_it');
--> statement-breakpoint
CREATE TABLE "event_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "event_id" uuid NOT NULL,
  "rating" "event_review_rating" NOT NULL,
  "comment" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_reviews" ADD CONSTRAINT "event_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "event_reviews" ADD CONSTRAINT "event_reviews_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "event_reviews_user_event_idx" ON "event_reviews" USING btree ("user_id", "event_id");
--> statement-breakpoint
CREATE INDEX "event_reviews_event_rating_idx" ON "event_reviews" USING btree ("event_id", "rating");
