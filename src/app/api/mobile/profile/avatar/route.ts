import { auth } from "@clerk/nextjs/server";
import { and, eq, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { uploadToS3 } from "@/lib/s3";
import { db } from "@/server/db";
import { userFriends, users } from "@/server/db/schema";
import { sendBackgroundPushToUsers } from "@/server/utils/push-notifications";
import { recordActivationActionBestEffort } from "@/server/utils/user-activation";
import { withStoredImageReplacements } from "@/server/utils/stored-image-lifecycle";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Only image files are allowed" },
        { status: 400 }
      );
    }

    const maxSize = 4 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File size must be less than 4MB" },
        { status: 400 }
      );
    }

    const existingUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { avatarImageUrl: true },
    });
    const avatarImageUrl = await uploadToS3(
      file,
      `users/${userId}/avatars`,
      "avatar-image.jpg"
    );

    const [updatedUser] = await withStoredImageReplacements({
      db,
      replacements: [
        { oldUrl: existingUser?.avatarImageUrl, newUrl: avatarImageUrl },
      ],
      persist: () =>
        db
          .update(users)
          .set({ avatarImageUrl, updatedAt: new Date() })
          .where(eq(users.id, userId))
          .returning({ avatarImageUrl: users.avatarImageUrl }),
    });

    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await recordActivationActionBestEffort(
      userId,
      "add_profile_photo",
      "profile_photo"
    );

    try {
      const friendships = await db.query.userFriends.findMany({
        where: and(
          eq(userFriends.status, "accepted"),
          or(
            eq(userFriends.userId, userId),
            eq(userFriends.friendUserId, userId)
          )
        ),
        columns: {
          userId: true,
          friendUserId: true,
        },
      });
      const friendUserIds = friendships.map((friendship) =>
        friendship.userId === userId
          ? friendship.friendUserId
          : friendship.userId
      );

      await sendBackgroundPushToUsers(friendUserIds, {
        data: {
          type: "profile_updated",
          userId,
        },
      });
    } catch (error) {
      // The avatar update is already complete. A failed refresh hint should not
      // turn a successful upload into an error for the user who changed it.
      console.error("Profile update background push failed", error);
    }

    return NextResponse.json({
      avatarImageUrl: updatedUser.avatarImageUrl,
    });
  } catch (error) {
    console.error("Mobile profile avatar upload error:", error);
    return NextResponse.json(
      { error: "Failed to update profile image" },
      { status: 500 }
    );
  }
}
