CREATE TYPE "public"."support_ticket_reported_entity_type" AS ENUM('user', 'place', 'event');
--> statement-breakpoint
ALTER TABLE "support_tickets"
ADD COLUMN "reported_entity_type" "support_ticket_reported_entity_type",
ADD COLUMN "reported_entity_id" text,
ADD CONSTRAINT "support_tickets_reported_entity_pair_check"
CHECK (("reported_entity_type" IS NULL) = ("reported_entity_id" IS NULL));
--> statement-breakpoint
CREATE INDEX "support_tickets_reported_entity_idx"
ON "support_tickets" USING btree ("reported_entity_type", "reported_entity_id");
