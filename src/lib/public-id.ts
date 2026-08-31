import { z } from "zod";

export const PUBLIC_ID_LENGTH = 20;
export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9]{20}$/;
// Only the detail page is shareable; /event/new and nested editing routes
// must continue through the authentication guard.
export const PUBLIC_EVENT_PATH_PATTERN = new RegExp(
  `^/event/[A-Za-z0-9]{${PUBLIC_ID_LENGTH}}/?$`
);

export const publicIdSchema = z
  .string()
  .length(PUBLIC_ID_LENGTH)
  .regex(PUBLIC_ID_PATTERN);

export const publicOrUuidSchema = z.union([z.string().uuid(), publicIdSchema]);

export function isPublicId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}
