CREATE TABLE "event_series_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "event_series_categories_series_category_idx" ON "event_series_categories" USING btree ("series_id","category_id");
--> statement-breakpoint
CREATE INDEX "event_series_categories_series_idx" ON "event_series_categories" USING btree ("series_id");
--> statement-breakpoint
CREATE INDEX "event_series_categories_category_idx" ON "event_series_categories" USING btree ("category_id");
--> statement-breakpoint
ALTER TABLE "event_series_categories" ADD CONSTRAINT "event_series_categories_series_id_event_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."event_series"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "event_series_categories" ADD CONSTRAINT "event_series_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "event_series_categories" ("series_id", "category_id")
SELECT
	es."id" AS "series_id",
	c."id" AS "category_id"
FROM "event_series" es
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(es."categories", '[]'::jsonb)) AS key(value)
INNER JOIN "categories" c ON c."key" = key.value
ON CONFLICT ("series_id", "category_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "event_series" DROP COLUMN "categories";
