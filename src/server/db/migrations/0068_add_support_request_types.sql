ALTER TYPE "public"."support_ticket_type" ADD VALUE IF NOT EXISTS 'incorrect-data';
--> statement-breakpoint
ALTER TYPE "public"."support_ticket_type" ADD VALUE IF NOT EXISTS 'event-request';
--> statement-breakpoint
ALTER TYPE "public"."support_ticket_type" ADD VALUE IF NOT EXISTS 'place-request';
