import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { userFriendsMutedNotifications, users } from "@/server/db/schema";

export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
      avatarImageUrl: users.avatarImageUrl,
    })
    .from(userFriendsMutedNotifications)
    .innerJoin(users, eq(users.id, userFriendsMutedNotifications.friendUserId))
    .where(
      and(
        eq(userFriendsMutedNotifications.userId, userId),
        eq(users.isProfileHidden, false)
      )
    )
    .orderBy(asc(users.firstName), asc(users.username));
  return NextResponse.json(
    {
      users: rows.map(({ firstName, lastName, ...user }) => ({
        ...user,
        name:
          [firstName, lastName].filter(Boolean).join(" ").trim() ||
          user.username,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
