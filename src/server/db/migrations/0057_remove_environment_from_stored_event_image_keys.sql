UPDATE "events"
SET "cover_image_url" = regexp_replace(
  "cover_image_url",
  '^(https://whoisgoing\.s3\.us-east-2\.amazonaws\.com/)?(production|development|test)/+',
  ''
)
WHERE "cover_image_url" ~ '^(https://whoisgoing\.s3\.us-east-2\.amazonaws\.com/)?(production|development|test)/+';

UPDATE "event_series"
SET "cover_image_url" = regexp_replace(
  "cover_image_url",
  '^(https://whoisgoing\.s3\.us-east-2\.amazonaws\.com/)?(production|development|test)/+',
  ''
)
WHERE "cover_image_url" ~ '^(https://whoisgoing\.s3\.us-east-2\.amazonaws\.com/)?(production|development|test)/+';
