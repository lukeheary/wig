import { z } from "zod";

export const promoUrlSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() || null : value),
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
