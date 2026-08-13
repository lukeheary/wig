UPDATE "users"
SET "avatar_image_url" = regexp_replace(
  "avatar_image_url",
  '^(https://whoisgoing\.s3\.us-east-2\.amazonaws\.com/|https://[^/]+\.r2\.dev/|https://[^/]+\.r2\.cloudflarestorage\.com/(whoisgoing/)?)?(production|development|test)/+',
  ''
)
WHERE "avatar_image_url" ~ '^(https://whoisgoing\.s3\.us-east-2\.amazonaws\.com/|https://[^/]+\.r2\.dev/|https://[^/]+\.r2\.cloudflarestorage\.com/(whoisgoing/)?)?(production|development|test)/+';
--> statement-breakpoint
UPDATE "places"
SET "logo_image_url" = regexp_replace(
  "logo_image_url",
  '^(https://whoisgoing\.s3\.us-east-2\.amazonaws\.com/|https://[^/]+\.r2\.dev/|https://[^/]+\.r2\.cloudflarestorage\.com/(whoisgoing/)?)?(production|development|test)/+',
  ''
)
WHERE "logo_image_url" ~ '^(https://whoisgoing\.s3\.us-east-2\.amazonaws\.com/|https://[^/]+\.r2\.dev/|https://[^/]+\.r2\.cloudflarestorage\.com/(whoisgoing/)?)?(production|development|test)/+';
