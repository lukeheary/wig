import { auth } from "@clerk/nextjs/server";
import { asc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { uploadToS3 } from "@/lib/s3";
import { users } from "@/server/db/schema";

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

export async function POST(request: NextRequest) {
  try {
    const userId = await currentMobileUserId();

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

    const folder = String(formData.get("folder") ?? "uploads").trim() || "uploads";
    const filename = String(formData.get("filename") ?? "").trim() || undefined;
    const url = await uploadToS3(file, folder, filename);

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Mobile upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload image" },
      { status: 500 }
    );
  }
}
