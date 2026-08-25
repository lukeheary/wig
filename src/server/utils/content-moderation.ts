export const CONTENT_MODERATION_REJECTION_MESSAGE =
  "This content may violate WIG's Community Guidelines. Please revise it and try again.";

export type ContentModerationCategory =
  | "hate_or_harassment"
  | "sexual_exploitation"
  | "sexual_solicitation"
  | "violent_threat"
  | "spam_or_scam";

export type ContentModerationResult =
  | { allowed: true }
  | {
      allowed: false;
      category: ContentModerationCategory;
      field: string;
    };

type ModeratedField = {
  field: string;
  value: string | null | undefined;
};

const CHARACTER_SUBSTITUTIONS: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
};

const BLOCKED_PATTERNS: Array<{
  category: ContentModerationCategory;
  patterns: RegExp[];
}> = [
  {
    category: "sexual_exploitation",
    patterns: [
      /\b(?:child|minor|underage)\s+(?:porn|nudes?|sex)\b/,
      /\b(?:buy|sell|send|share)\s+(?:child|minor|underage)\s+nudes?\b/,
    ],
  },
  {
    category: "violent_threat",
    patterns: [
      /\bi(?:'| a)?m\s+going\s+to\s+(?:kill|shoot|stab|bomb)\s+(?:you|them|him|her)\b/,
      /\b(?:kill|shoot|stab|bomb)\s+(?:you|them|him|her|everyone)\b/,
      /\byou\s+(?:should|deserve\s+to)\s+die\b/,
    ],
  },
  {
    category: "sexual_solicitation",
    patterns: [
      /\b(?:pay|cash|venmo|cashapp)\s+(?:me\s+)?for\s+sex\b/,
      /\b(?:escort|sexual services?)\s+(?:available|for hire)\b/,
      /\b(?:buy|sell|send)\s+nudes?\b/,
    ],
  },
  {
    category: "spam_or_scam",
    patterns: [
      /\b(?:guaranteed|instant)\s+(?:crypto|investment)\s+(?:returns?|profit)\b/,
      /\bsend\s+(?:money|crypto)\s+(?:now|first)\b/,
      /\b(?:double|triple)\s+your\s+(?:money|crypto)\b/,
      /\bcontact\s+me\s+on\s+(?:telegram|whatsapp)\s+for\s+(?:profit|returns?|investment)\b/,
    ],
  },
  {
    category: "hate_or_harassment",
    patterns: [
      /\b(?:all|every)\s+(?:jews?|muslims?|christians?|blacks?|asians?|gays?|lesbians?|trans(?:gender)? people)\s+(?:should|must)\s+(?:die|leave|be killed)\b/,
      /\b(?:kill|exterminate)\s+(?:all\s+)?(?:jews?|muslims?|christians?|blacks?|asians?|gays?|lesbians?|trans(?:gender)? people)\b/,
    ],
  },
];

function normalizeForModeration(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(
      /[013457@$]/g,
      (character) => CHARACTER_SUBSTITUTIONS[character] ?? character
    )
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function moderateTextFields(
  fields: ModeratedField[]
): ContentModerationResult {
  for (const field of fields) {
    const value = field.value?.trim();
    if (!value) continue;

    const normalized = normalizeForModeration(value);
    for (const rule of BLOCKED_PATTERNS) {
      if (rule.patterns.some((pattern) => pattern.test(normalized))) {
        return { allowed: false, category: rule.category, field: field.field };
      }
    }
  }

  return { allowed: true };
}

export class ContentModerationError extends Error {
  readonly category: ContentModerationCategory;
  readonly field: string;

  constructor(result: Exclude<ContentModerationResult, { allowed: true }>) {
    super(CONTENT_MODERATION_REJECTION_MESSAGE);
    this.name = "ContentModerationError";
    this.category = result.category;
    this.field = result.field;
  }
}

export function assertTextContentAllowed(fields: ModeratedField[]): void {
  const result = moderateTextFields(fields);
  if (!result.allowed) throw new ContentModerationError(result);
}

export function assertTRPCTextContentAllowed(fields: ModeratedField[]): void {
  const result = moderateTextFields(fields);
  if (!result.allowed) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: CONTENT_MODERATION_REJECTION_MESSAGE,
    });
  }
}

export function isContentModerationError(
  error: unknown
): error is ContentModerationError {
  return error instanceof ContentModerationError;
}
import { TRPCError } from "@trpc/server";
