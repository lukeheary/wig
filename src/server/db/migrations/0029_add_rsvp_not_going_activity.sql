DO $$
BEGIN
  IF to_regclass('public.activity') IS NOT NULL
    AND to_regclass('public.user_activity') IS NULL THEN
    ALTER TABLE "activity" RENAME TO "user_activity";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'activity_type'
      AND e.enumlabel = 'rsvp_not_going'
  ) THEN
    ALTER TYPE "activity_type" ADD VALUE 'rsvp_not_going';
  END IF;
END $$;
