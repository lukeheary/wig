ALTER TABLE "users" RENAME COLUMN "avatar_image_url" TO "avatar_image";--> statement-breakpoint
ALTER TABLE "places" RENAME COLUMN "logo_image_url" TO "logo_image";--> statement-breakpoint
ALTER TABLE "places" RENAME COLUMN "banner_image_url" TO "banner_image";--> statement-breakpoint
ALTER TABLE "event_series" RENAME COLUMN "cover_image_url" TO "cover_image";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "cover_image_url" TO "cover_image";
