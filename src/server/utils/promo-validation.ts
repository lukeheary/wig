import { z } from "zod";

export const promoUrlSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    // Preserve explicit schemes so unsupported ones still fail validation.
    if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  },
  z
    .string()
    .max(2048)
    .url()
    .refine((value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    }, "Promo link must be an HTTP or HTTPS URL without embedded credentials.")
    .nullable()
    .optional()
);
