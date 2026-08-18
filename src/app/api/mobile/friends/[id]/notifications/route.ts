import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import {
  userFriends,
  userFriendsMutedNotifications,
  users,
} from "@/server/db/schema";

async function currentMobileUserId() {
  const { userId } = await auth();

  if (userId) {
    return userId;
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: { id: true },
  });

  return previewUser?.id ?? null;
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function acceptedFriendship(userId: string, friendUserId: string) {
  return db.query.userFriends.findFirst({
    where: and(
      eq(userFriends.status, "accepted"),
      or(
        and(
          eq(userFriends.userId, userId),
          eq(userFriends.friendUserId, friendUserId)
        ),
        and(
          eq(userFriends.userId, friendUserId),
          eq(userFriends.friendUserId, userId)
        )
      )
    ),
    columns: { id: true },
  });
}

export async function POST(_: Request, context: RouteContext) {
  const userId = await currentMobileUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: friendUserId } = await context.params;
  if (!(await acceptedFriendship(userId, friendUserId))) {
    return NextResponse.json({ error: "Friend not found" }, { status: 404 });
  }

  await db
    .insert(userFriendsMutedNotifications)
    .values({ userId, friendUserId })
    .onConflictDoNothing();

  return NextResponse.json({ notificationsMuted: true });
}

export async function DELETE(_: Request, context: RouteContext) {
  const userId = await currentMobileUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: friendUserId } = await context.params;
  if (!(await acceptedFriendship(userId, friendUserId))) {
    return NextResponse.json({ error: "Friend not found" }, { status: 404 });
  }

  await db
    .delete(userFriendsMutedNotifications)
    .where(
      and(
        eq(userFriendsMutedNotifications.userId, userId),
        eq(userFriendsMutedNotifications.friendUserId, friendUserId)
      )
    );

  return NextResponse.json({ notificationsMuted: false });
}
