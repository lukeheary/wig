import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { asc, eq, or } from "drizzle-orm";
import { db } from "@/server/db";
import { userFriends, users } from "@/server/db/schema";

type UserSummary = {
  id: string;
  name: string;
  username: string;
  avatarImageUrl: string | null;
};

function userSummary(user: typeof users.$inferSelect | null | undefined): UserSummary | null {
  if (!user) return null;

  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    "Someone";

  return {
    id: user.id,
    name,
    username: user.username,
    avatarImageUrl: user.avatarImageUrl,
  };
}

async function currentMobileUserId() {
  const { userId } = await auth();

  if (userId) {
    return userId;
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: {
      id: true,
    },
  });

  return previewUser?.id ?? null;
}

export async function GET() {
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({
      profile: null,
      friendCount: 0,
      requestCount: 0,
      friends: [],
      receivedRequests: [],
      sentRequests: [],
    });
  }

  const profile = userSummary(
    await db.query.users.findFirst({
      where: eq(users.id, userId),
    })
  );

  const friendships = await db.query.userFriends.findMany({
    where: or(eq(userFriends.userId, userId), eq(userFriends.friendUserId, userId)),
    orderBy: [asc(userFriends.createdAt)],
    with: {
      user: true,
      friend: true,
    },
  });

  const acceptedByUserId = new Map<string, UserSummary>();
  const sentRequests: UserSummary[] = [];
  const receivedRequests: UserSummary[] = [];
  let pendingRequestCount = 0;

  for (const friendship of friendships) {
    if (friendship.status === "accepted") {
      const otherUser =
        friendship.userId === userId ? friendship.friend : friendship.user;
      const friend = userSummary(otherUser);

      if (friend) acceptedByUserId.set(friend.id, friend);
      continue;
    }

    if (friendship.status === "pending") {
      pendingRequestCount += 1;

      if (friendship.friendUserId === userId) {
        const sender = userSummary(friendship.user);
        if (sender) receivedRequests.push(sender);
      } else {
        const recipient = userSummary(friendship.friend);
        if (recipient) sentRequests.push(recipient);
      }
    }
  }

  return NextResponse.json({
    profile,
    friendCount: acceptedByUserId.size,
    requestCount: pendingRequestCount,
    friends: [...acceptedByUserId.values()],
    receivedRequests,
    sentRequests,
  });
}
