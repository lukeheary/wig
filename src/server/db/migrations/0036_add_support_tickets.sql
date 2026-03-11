CREATE TYPE "public"."support_ticket_type" AS ENUM('help', 'bug', 'feedback', 'feature-request');
--> statement-breakpoint
CREATE TYPE "public"."support_ticket_status" AS ENUM('open', 'in-review', 'closed', 'planned', 'resolved');
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" "support_ticket_type" NOT NULL,
	"status" "support_ticket_status" DEFAULT 'open' NOT NULL,
	"subject" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "support_tickets_user_created_at_idx" ON "support_tickets" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "support_tickets_type_idx" ON "support_tickets" USING btree ("type");
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
