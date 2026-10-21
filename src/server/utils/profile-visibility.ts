import { auth } from "@clerk/nextjs/server";
import { and, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

/** The owner can still use their account. Hidden profiles are not public. */
export function visibleProfileCondition(
  column: AnyColumn,
  viewerId: string | null = null
) {
  return sql`not exists (
    select 1 from users hidden_profile
    where hidden_profile.id = ${column}
      and hidden_profile.is_profile_hidden = true
      and hidden_profile.id is distinct from ${viewerId}
  )`;
}

/** Apply to social read queries, including both ends of a relationship. */
export async function withVisibleProfiles(
  where: SQL | undefined,
  ...columns: AnyColumn[]
) {
  const { userId } = await auth();
  return and(
    where,
    ...columns.map((column) => visibleProfileCondition(column, userId))
  );
}

export async function isProfileHidden(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isProfileHidden: true },
  });
  return user?.isProfileHidden ?? false;
}

/** Partner mirroring must never publish on behalf of a hidden account. */
export function withPublicProfiles(
  where: SQL | undefined,
  ...columns: AnyColumn[]
) {
  return and(
    where,
    ...columns.map((column) => visibleProfileCondition(column))
  );
}
