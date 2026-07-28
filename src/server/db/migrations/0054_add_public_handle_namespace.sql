CREATE TABLE "public_handles" (
	"handle" varchar(100) PRIMARY KEY NOT NULL,
	"owner_kind" varchar(20) NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "public_handles_owner_kind_check" CHECK ("owner_kind" IN ('user', 'place', 'reserved'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "public_handles_owner_idx" ON "public_handles" USING btree ("owner_kind", "owner_id");
--> statement-breakpoint
INSERT INTO "public_handles" ("handle", "owner_kind", "owner_id") VALUES
	('admin', 'reserved', 'admin'),
	('api', 'reserved', 'api'),
	('event', 'reserved', 'event'),
	('event-series', 'reserved', 'event-series'),
	('friends', 'reserved', 'friends'),
	('help-feedback', 'reserved', 'help-feedback'),
	('home', 'reserved', 'home'),
	('my-places', 'reserved', 'my-places'),
	('onboarding', 'reserved', 'onboarding'),
	('organizer', 'reserved', 'organizer'),
	('places', 'reserved', 'places'),
	('profile', 'reserved', 'profile'),
	('sign-in', 'reserved', 'sign-in'),
	('sign-up', 'reserved', 'sign-up'),
	('support', 'reserved', 'support'),
	('venue', 'reserved', 'venue'),
	('venues-and-organizers', 'reserved', 'venues-and-organizers'),
	('www', 'reserved', 'www');
--> statement-breakpoint
INSERT INTO "public_handles" ("handle", "owner_kind", "owner_id")
SELECT lower("username"), 'user', "id" FROM "users";
--> statement-breakpoint
INSERT INTO "public_handles" ("handle", "owner_kind", "owner_id")
SELECT lower("slug"), 'place', "id"::text FROM "places";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_public_handle_namespace()
RETURNS trigger AS $$
DECLARE
	new_handle text;
	old_handle text;
	entity_kind text;
	entity_id text;
BEGIN
	entity_kind := CASE WHEN TG_TABLE_NAME = 'users' THEN 'user' ELSE 'place' END;

	IF TG_OP = 'DELETE' THEN
		entity_id := OLD.id::text;
		DELETE FROM public_handles
		WHERE owner_kind = entity_kind AND owner_id = entity_id;
		RETURN OLD;
	END IF;

	entity_id := NEW.id::text;
	new_handle := lower(
		CASE
			WHEN TG_TABLE_NAME = 'users' THEN to_jsonb(NEW)->>'username'
			ELSE to_jsonb(NEW)->>'slug'
		END
	);

	IF TG_OP = 'UPDATE' THEN
		old_handle := lower(
			CASE
				WHEN TG_TABLE_NAME = 'users' THEN to_jsonb(OLD)->>'username'
				ELSE to_jsonb(OLD)->>'slug'
			END
		);
		IF old_handle = new_handle THEN
			RETURN NEW;
		END IF;

		DELETE FROM public_handles
		WHERE owner_kind = entity_kind AND owner_id = entity_id;
	END IF;

	INSERT INTO public_handles (handle, owner_kind, owner_id)
	VALUES (new_handle, entity_kind, entity_id);

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "users_sync_public_handle"
AFTER INSERT OR UPDATE OF "username" OR DELETE ON "users"
FOR EACH ROW EXECUTE FUNCTION sync_public_handle_namespace();
--> statement-breakpoint
CREATE TRIGGER "places_sync_public_handle"
AFTER INSERT OR UPDATE OF "slug" OR DELETE ON "places"
FOR EACH ROW EXECUTE FUNCTION sync_public_handle_namespace();
