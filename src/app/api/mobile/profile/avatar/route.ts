import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { uploadToS3 } from "@/lib/s3";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

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

    const avatarImageUrl = await uploadToS3(
      file,
      `users/${userId}`,
      `avatar-image-${Date.now()}.jpg`
    );

    const [updatedUser] = await db
      .update(users)
      .set({
        avatarImageUrl,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({
        avatarImageUrl: users.avatarImageUrl,
      });

    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
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
