DO $$
BEGIN
  CREATE TYPE "public"."rsvp_not_going_reason" AS ENUM('busy', 'out_of_town', 'working', 'laying_low');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "event_rsvps" ADD COLUMN "not_going_reason" "rsvp_not_going_reason";
