CREATE TABLE "user_notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"friend_rsvp_push_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "user_notification_preferences_friend_rsvp_idx" ON "user_notification_preferences" USING btree ("friend_rsvp_push_enabled");
--> statement-breakpoint
CREATE TABLE "user_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_registered_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "user_push_tokens" ADD CONSTRAINT "user_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_push_tokens_token_idx" ON "user_push_tokens" USING btree ("token");
--> statement-breakpoint
CREATE UNIQUE INDEX "user_push_tokens_user_token_idx" ON "user_push_tokens" USING btree ("user_id","token");
--> statement-breakpoint
CREATE INDEX "user_push_tokens_user_revoked_idx" ON "user_push_tokens" USING btree ("user_id","revoked_at");
