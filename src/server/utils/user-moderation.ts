import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

export const ACCOUNT_RESTRICTED_MESSAGE =
  "Your account is currently restricted from creating or editing content. Contact support@whoisgoing.com if you believe this is a mistake.";

export class AccountRestrictedError extends Error {
  constructor() {
    super(ACCOUNT_RESTRICTED_MESSAGE);
    this.name = "AccountRestrictedError";
  }
}

export async function assertUserCanCreateContent(
  userId: string
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true, moderationStatus: true },
  });

  // A missing row is expected during first-time onboarding. Admins retain
  // access so they can investigate and resolve moderation reports.
  if (!user || user.role === "admin") return;
  if (user.moderationStatus !== "active") throw new AccountRestrictedError();
}

export function isAccountRestrictedError(
  error: unknown
): error is AccountRestrictedError {
  return error instanceof AccountRestrictedError;
}
