ALTER TABLE "places"
ADD COLUMN "aliases" text[] DEFAULT ARRAY[]::text[] NOT NULL;
