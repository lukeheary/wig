import { and, eq, or } from "drizzle-orm";
import { db } from "@/server/db";
import { userBlocks } from "@/server/db/schema";

export async function usersAreBlocked(userA: string, userB: string) {
  if (userA === userB) return false;

  const block = await db.query.userBlocks.findFirst({
    where: or(
      and(
        eq(userBlocks.blockerUserId, userA),
        eq(userBlocks.blockedUserId, userB)
      ),
      and(
        eq(userBlocks.blockerUserId, userB),
        eq(userBlocks.blockedUserId, userA)
      )
    ),
    columns: { blockerUserId: true },
  });

  return Boolean(block);
}

export async function blockedUserIdsFor(userId: string) {
  const blocks = await db.query.userBlocks.findMany({
    where: or(
      eq(userBlocks.blockerUserId, userId),
      eq(userBlocks.blockedUserId, userId)
    ),
    columns: {
      blockerUserId: true,
      blockedUserId: true,
    },
  });

  return new Set(
    blocks.map((block) =>
      block.blockerUserId === userId ? block.blockedUserId : block.blockerUserId
    )
  );
}
