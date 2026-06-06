ALTER TABLE "events" RENAME COLUMN "image_url" TO "cover_image_url";--> statement-breakpoint
ALTER TABLE "places" RENAME COLUMN "image_url" TO "logo_image_url";--> statement-breakpoint
ALTER TABLE "places" RENAME COLUMN "banner_url" TO "banner_image_url";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "image_url" TO "avatar_image_url";