import { NextResponse } from "next/server";
import {
  assertTextContentAllowed,
  isContentModerationError,
} from "@/server/utils/content-moderation";
import {
  assertUserCanCreateContent,
  isAccountRestrictedError,
} from "@/server/utils/user-moderation";

type ModeratedField = {
  field: string;
  value: string | null | undefined;
};

export async function enforceMobileContentCreation(
  userId: string,
  fields: ModeratedField[]
): Promise<void> {
  await assertUserCanCreateContent(userId);
  assertTextContentAllowed(fields);
}

export function mobileContentModerationErrorResponse(
  error: unknown
): NextResponse | null {
  if (isContentModerationError(error)) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (isAccountRestrictedError(error)) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return null;
}
