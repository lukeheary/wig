ALTER TYPE "public"."support_ticket_type" ADD VALUE IF NOT EXISTS 'incorrect-data';
ALTER TYPE "public"."support_ticket_type" ADD VALUE IF NOT EXISTS 'event-request';
ALTER TYPE "public"."support_ticket_type" ADD VALUE IF NOT EXISTS 'place-request';
