CREATE TABLE "event_source_visibility" (
  "source" varchar(50) PRIMARY KEY NOT NULL,
  "hidden" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
