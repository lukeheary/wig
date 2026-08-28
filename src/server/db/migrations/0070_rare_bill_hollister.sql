CREATE TABLE "user_promoted_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_promoted_events" ADD CONSTRAINT "user_promoted_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_promoted_events" ADD CONSTRAINT "user_promoted_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_promoted_events_user_event_idx" ON "user_promoted_events" USING btree ("user_id","event_id");
--> statement-breakpoint
CREATE INDEX "user_promoted_events_user_idx" ON "user_promoted_events" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "user_promoted_events_event_idx" ON "user_promoted_events" USING btree ("event_id");
