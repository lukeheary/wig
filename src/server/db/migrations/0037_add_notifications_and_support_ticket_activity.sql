CREATE TYPE "public"."notification_type" AS ENUM('event_update', 'support_ticket_status_changed');
--> statement-breakpoint
CREATE TYPE "public"."notification_entity_type" AS ENUM('event', 'support_ticket');
--> statement-breakpoint
CREATE TYPE "public"."support_ticket_activity_type" AS ENUM('created', 'status_changed');
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"actor_user_id" text,
	"type" "notification_type" NOT NULL,
	"entity_type" "notification_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"action_url" text,
	"metadata" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_ticket_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"actor_user_id" text,
	"type" "support_ticket_activity_type" NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notifications_user_read_created_at_idx" ON "notifications" USING btree ("user_id","read_at","created_at");
--> statement-breakpoint
CREATE INDEX "notifications_user_created_at_idx" ON "notifications" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" USING btree ("entity_type","entity_id");
--> statement-breakpoint
CREATE INDEX "support_ticket_activity_ticket_created_at_idx" ON "support_ticket_activity" USING btree ("ticket_id","created_at");
--> statement-breakpoint
CREATE INDEX "support_ticket_activity_actor_created_at_idx" ON "support_ticket_activity" USING btree ("actor_user_id","created_at");
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_ticket_activity" ADD CONSTRAINT "support_ticket_activity_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_ticket_activity" ADD CONSTRAINT "support_ticket_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "event_updates_last_seen_at";
