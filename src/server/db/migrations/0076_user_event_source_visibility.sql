CREATE TABLE "user_event_source_visibility" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source" varchar(50) NOT NULL,
  "hidden" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "source")
);
