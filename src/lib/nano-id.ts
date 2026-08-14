import { customAlphabet } from "nanoid";

const ALPHANUMERIC_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const NANO_ID_LENGTH = 20;
const createNanoId = customAlphabet(ALPHANUMERIC_ALPHABET, NANO_ID_LENGTH);

/** Generate a URL-safe, case-sensitive, 20-character alphanumeric ID. */
export function generateNanoId(): string {
  return createNanoId();
}
