DROP TABLE IF EXISTS "user_notification_preferences";
--> statement-breakpoint

CREATE TABLE "user_friends_muted_notifications" (
	"user_id" text NOT NULL,
	"friend_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_friends_muted_notifications_user_id_friend_user_id_pk" PRIMARY KEY("user_id","friend_user_id")
);
--> statement-breakpoint

ALTER TABLE "user_friends_muted_notifications" ADD CONSTRAINT "user_friends_muted_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_friends_muted_notifications" ADD CONSTRAINT "user_friends_muted_notifications_friend_user_id_users_id_fk" FOREIGN KEY ("friend_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "user_friends_muted_notifications_friend_user_idx" ON "user_friends_muted_notifications" USING btree ("friend_user_id");
