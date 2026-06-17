import { auth } from "@clerk/nextjs/server";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { userFriends, users } from "@/server/db/schema";
import { deleteNotificationsForEntity } from "@/server/utils/notifications";

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

export async function DELETE(_: Request, context: RouteContext) {
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const friendRequest = await db.query.userFriends.findFirst({
    where: eq(userFriends.id, id),
  });

  if (!friendRequest) {
    return NextResponse.json({ error: "Friend request not found" }, { status: 404 });
  }

  if (friendRequest.friendUserId !== userId && friendRequest.userId !== userId) {
    return NextResponse.json(
      { error: "You cannot reject this request" },
      { status: 403 }
    );
  }

  await db.delete(userFriends).where(eq(userFriends.id, id));

  await deleteNotificationsForEntity(
    {
      entityType: "friend_request",
      entityIds: [id],
    },
    db
  );

  return NextResponse.json({});
}
