DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'recurrence_frequency'
      AND e.enumlabel = 'monthly'
  ) THEN
    ALTER TYPE "recurrence_frequency" ADD VALUE 'monthly';
  END IF;
END $$;
