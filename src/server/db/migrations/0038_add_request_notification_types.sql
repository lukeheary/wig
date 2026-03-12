ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'friend_request';
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'friend_request_accepted';
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'partner_request';
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'partner_request_accepted';
ALTER TYPE "public"."notification_entity_type" ADD VALUE IF NOT EXISTS 'friend_request';
ALTER TYPE "public"."notification_entity_type" ADD VALUE IF NOT EXISTS 'partner_request';
