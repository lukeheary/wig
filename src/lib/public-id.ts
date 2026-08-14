import { z } from "zod";

export const PUBLIC_ID_LENGTH = 20;
export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

export const publicIdSchema = z
  .string()
  .length(PUBLIC_ID_LENGTH)
  .regex(PUBLIC_ID_PATTERN);

export const publicOrUuidSchema = z.union([z.string().uuid(), publicIdSchema]);

export function isPublicId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}
