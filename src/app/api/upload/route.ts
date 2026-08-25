import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { isUserImageValidationError, uploadToS3 } from "@/lib/s3";
import {
  ACCOUNT_RESTRICTED_MESSAGE,
  assertUserCanCreateContent,
  isAccountRestrictedError,
} from "@/server/utils/user-moderation";

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await assertUserCanCreateContent(userId);

    // Get form data
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const folder = (formData.get("folder") as string) || "uploads";
    const filename = formData.get("filename") as string | undefined;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type (images only)
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Only image files are allowed" },
        { status: 400 }
      );
    }

    // Validate file size (max 4MB)
    const maxSize = 4 * 1024 * 1024; // 4MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File size must be less than 4MB" },
        { status: 400 }
      );
    }

    // Upload to Cloudflare R2
    const url = await uploadToS3(file, folder, filename);

    return NextResponse.json({
      success: true,
      url,
      uploadedBy: userId,
    });
  } catch (error) {
    if (isAccountRestrictedError(error)) {
      return NextResponse.json(
        { error: ACCOUNT_RESTRICTED_MESSAGE },
        { status: 403 }
      );
    }
    if (isUserImageValidationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    );
  }
}
