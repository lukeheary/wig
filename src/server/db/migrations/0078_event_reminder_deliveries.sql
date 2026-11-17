CREATE TABLE "event_reminder_deliveries" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "claim_token" uuid NOT NULL,
  "claimed_at" timestamp NOT NULL,
  "sent_at" timestamp,
  PRIMARY KEY ("user_id", "event_id")
);
