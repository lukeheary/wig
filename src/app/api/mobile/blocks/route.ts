import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { userBlocks, users } from "@/server/db/schema";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blocks = await db
    .select({
      id: users.id,
      name: users.firstName,
      lastName: users.lastName,
      username: users.username,
      avatarImageUrl: users.avatarImageUrl,
      city: users.city,
      state: users.state,
      blockedAt: userBlocks.createdAt,
    })
    .from(userBlocks)
    .innerJoin(users, eq(userBlocks.blockedUserId, users.id))
    .where(eq(userBlocks.blockerUserId, userId))
    .orderBy(desc(userBlocks.createdAt));

  return NextResponse.json({
    users: blocks.map(({ name, lastName, ...block }) => ({
      ...block,
      name:
        [name, lastName].filter(Boolean).join(" ").trim() ||
        block.username ||
        "Someone",
    })),
  });
}
