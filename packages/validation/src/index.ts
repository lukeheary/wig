import { z } from "zod";

export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username must be at most 20 characters")
  .regex(
    /^[a-zA-Z0-9_]+$/,
    "Username can only contain letters, numbers, and underscores"
  );

export const genderSchema = z.enum(["male", "female", "other"]);

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const onboardingProfileSchema = z.object({
  username: usernameSchema,
  city: z.string().min(1),
  state: z.string().length(2),
  gender: genderSchema.optional(),
  dateOfBirth: isoDateSchema.optional(),
  avatarImageUrl: z.string().url().optional(),
});

export const profileUpdateSchema = z.object({
  username: usernameSchema.optional(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  avatarImageUrl: z.string().url().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  gender: genderSchema.optional(),
  dateOfBirth: isoDateSchema.optional(),
});

export const rsvpStatusSchema = z.enum(["going", "interested", "not_going"]);
