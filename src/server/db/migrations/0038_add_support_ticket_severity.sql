CREATE TYPE "public"."support_ticket_severity" AS ENUM('low', 'medium', 'high');
--> statement-breakpoint
ALTER TABLE "support_tickets"
ADD COLUMN "severity" "support_ticket_severity" DEFAULT 'low' NOT NULL;
