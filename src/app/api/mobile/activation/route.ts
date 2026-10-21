import { withVisibleProfiles } from "@/server/utils/profile-visibility";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/server/db";
import { placeFollows, userFriends, users } from "@/server/db/schema";
import {
  activationState,
  recordActivationAction,
} from "@/server/utils/user-activation";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Seed existing users from their current account state. Once recorded, these
    // milestones remain complete even if a relationship is later removed.
    const [friendships, follows, user] = await Promise.all([
      db.query.userFriends.findMany({
        where: await withVisibleProfiles(or(
          eq(userFriends.userId, userId),
          and(
            eq(userFriends.friendUserId, userId),
            eq(userFriends.status, "accepted")
          )
        ), userFriends.userId, userFriends.friendUserId),
        columns: {
          userId: true,
          friendUserId: true,
        },
        limit: 3,
      }),
      db.query.placeFollows.findMany({
        where: await withVisibleProfiles(eq(placeFollows.userId, userId), placeFollows.userId),
        columns: {
          placeId: true,
        },
        limit: 2,
      }),
      db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { avatarImageUrl: true },
      }),
    ]);

    for (const friendship of friendships) {
      const subjectId =
        friendship.userId === userId
          ? friendship.friendUserId
          : friendship.userId;
      await recordActivationAction(userId, "add_friends", subjectId);
    }
    for (const follow of follows) {
      await recordActivationAction(userId, "follow_places", follow.placeId);
    }
    if (user?.avatarImageUrl) {
      await recordActivationAction(userId, "add_profile_photo", "profile_photo");
    }

    return NextResponse.json(await activationState(userId));
  } catch (error) {
    console.error("Mobile activation fetch error:", error);
    return NextResponse.json(
      { error: "Failed to load activation state" },
      { status: 500 }
    );
  }
}
