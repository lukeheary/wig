import { auth } from "@clerk/nextjs/server";
import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { userFriends, users } from "@/server/db/schema";
import { createNotification } from "@/server/utils/notifications";
import { sendPushNotificationToUsers } from "@/server/utils/push-notifications";

const requestSchema = z.object({
  friendUserId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = requestSchema.parse(await request.json());

    if (body.friendUserId === userId) {
      return NextResponse.json(
        { error: "Cannot send friend request to yourself" },
        { status: 400 }
      );
    }

    const friendUser = await db.query.users.findFirst({
      where: eq(users.id, body.friendUserId),
    });

    if (!friendUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existingFriendship = await db.query.userFriends.findFirst({
      where: or(
        and(
          eq(userFriends.userId, userId),
          eq(userFriends.friendUserId, body.friendUserId)
        ),
        and(
          eq(userFriends.userId, body.friendUserId),
          eq(userFriends.friendUserId, userId)
        )
      ),
    });

    if (existingFriendship) {
      return NextResponse.json(
        {
          error:
            existingFriendship.status === "accepted"
              ? "You are already friends"
              : "Friend request already exists",
        },
        { status: 409 }
      );
    }

    const [friendRequest] = await db
      .insert(userFriends)
      .values({
        userId,
        friendUserId: body.friendUserId,
        status: "pending",
      })
      .returning();

    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        firstName: true,
        lastName: true,
        username: true,
      },
    });

    const senderName =
      [currentUser?.firstName, currentUser?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      currentUser?.username ||
      "Someone";

    await createNotification({
      userId: body.friendUserId,
      actorUserId: userId,
      type: "friend_request",
      entityType: "friend_request",
      entityId: friendRequest.id,
      title: "Friend Request",
      body: `${senderName} sent you a friend request`,
      metadata: {
        requestId: friendRequest.id,
        requestType: "friend",
      },
    });

    await sendPushNotificationToUsers([body.friendUserId], {
      title: "Friend Request",
      body: `${senderName} sent you a friend request`,
      data: {
        type: "friend_request",
        entityId: friendRequest.id,
        actionUrl: "/friends/requests",
      },
    });

    return NextResponse.json({
      success: true,
      friendStatus: "pending_sent",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    console.error("Mobile friend request error:", error);
    return NextResponse.json(
      { error: "Failed to send friend request" },
      { status: 500 }
    );
  }
}
