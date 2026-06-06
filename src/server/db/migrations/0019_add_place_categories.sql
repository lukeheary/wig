CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"label" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "categories_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_key_idx" ON "categories" USING btree ("key");
--> statement-breakpoint
CREATE INDEX "categories_active_sort_idx" ON "categories" USING btree ("is_active","sort_order");
--> statement-breakpoint
CREATE TABLE "place_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "place_categories_place_category_idx" ON "place_categories" USING btree ("place_id","category_id");
--> statement-breakpoint
CREATE INDEX "place_categories_place_idx" ON "place_categories" USING btree ("place_id");
--> statement-breakpoint
CREATE INDEX "place_categories_category_idx" ON "place_categories" USING btree ("category_id");
--> statement-breakpoint
ALTER TABLE "place_categories" ADD CONSTRAINT "place_categories_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "place_categories" ADD CONSTRAINT "place_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "categories" ("key", "label", "sort_order")
VALUES
	('bars', 'Bars', 10),
	('clubs', 'Clubs', 20),
	('comedy', 'Comedy', 30),
	('concerts', 'Concerts', 40),
	('lgbt', 'LGBT', 50),
	('social', 'Social', 60),
	('theater', 'Theater', 70),
	('nightlife', 'Nightlife', 80)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "categories" ("key", "label", "sort_order")
SELECT DISTINCT
	trim(category_key) AS "key",
	initcap(replace(trim(category_key), '_', ' ')) AS "label",
	1000 AS "sort_order"
FROM (
	SELECT jsonb_array_elements_text(COALESCE(p."categories", '[]'::jsonb)) AS category_key
	FROM "places" p
) keys
WHERE trim(category_key) <> ''
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "place_categories" ("place_id", "category_id")
SELECT
	p."id" AS "place_id",
	c."id" AS "category_id"
FROM "places" p
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(p."categories", '[]'::jsonb)) AS key(value)
INNER JOIN "categories" c ON c."key" = key.value
ON CONFLICT ("place_id", "category_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "places" DROP COLUMN "categories";
