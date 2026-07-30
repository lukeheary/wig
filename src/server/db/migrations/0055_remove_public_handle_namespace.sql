DROP TRIGGER IF EXISTS "users_sync_public_handle" ON "users";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "places_sync_public_handle" ON "places";
--> statement-breakpoint
DROP FUNCTION IF EXISTS sync_public_handle_namespace();
--> statement-breakpoint
DROP TABLE IF EXISTS "public_handles";
