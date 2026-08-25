CREATE TYPE "public"."user_moderation_status" AS ENUM('active', 'suspended', 'banned');
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "moderation_status" "user_moderation_status" DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "moderation_reason" text;
--> statement-breakpoint
CREATE INDEX "users_moderation_status_idx" ON "users" USING btree ("moderation_status");
