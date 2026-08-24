import { auth } from "@clerk/nextjs/server";
import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import {
  notifications,
  userBlocks,
  userFriends,
  userFriendsMutedNotifications,
  userPartners,
  users,
} from "@/server/db/schema";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: blockedUserId } = await context.params;
  if (blockedUserId === userId) {
    return NextResponse.json(
      { error: "You cannot block yourself" },
      { status: 400 }
    );
  }

  const blockedUser = await db.query.users.findFirst({
    where: eq(users.id, blockedUserId),
    columns: { id: true },
  });
  if (!blockedUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await db.transaction(async (transaction) => {
    await transaction
      .insert(userBlocks)
      .values({ blockerUserId: userId, blockedUserId })
      .onConflictDoNothing();

    await transaction
      .delete(userFriends)
      .where(
        or(
          and(
            eq(userFriends.userId, userId),
            eq(userFriends.friendUserId, blockedUserId)
          ),
          and(
            eq(userFriends.userId, blockedUserId),
            eq(userFriends.friendUserId, userId)
          )
        )
      );

    await transaction
      .delete(userPartners)
      .where(
        or(
          and(
            eq(userPartners.requesterId, userId),
            eq(userPartners.recipientId, blockedUserId)
          ),
          and(
            eq(userPartners.requesterId, blockedUserId),
            eq(userPartners.recipientId, userId)
          )
        )
      );

    await transaction
      .delete(userFriendsMutedNotifications)
      .where(
        or(
          and(
            eq(userFriendsMutedNotifications.userId, userId),
            eq(userFriendsMutedNotifications.friendUserId, blockedUserId)
          ),
          and(
            eq(userFriendsMutedNotifications.userId, blockedUserId),
            eq(userFriendsMutedNotifications.friendUserId, userId)
          )
        )
      );

    await transaction
      .delete(notifications)
      .where(
        or(
          and(
            eq(notifications.userId, userId),
            eq(notifications.actorUserId, blockedUserId)
          ),
          and(
            eq(notifications.userId, blockedUserId),
            eq(notifications.actorUserId, userId)
          )
        )
      );
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(_: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: blockedUserId } = await context.params;
  await db
    .delete(userBlocks)
    .where(
      and(
        eq(userBlocks.blockerUserId, userId),
        eq(userBlocks.blockedUserId, blockedUserId)
      )
    );

  return NextResponse.json({ success: true });
}
