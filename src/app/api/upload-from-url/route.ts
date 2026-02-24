import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { uploadImageFromUrl } from "@/lib/s3";

const MAX_SIZE_BYTES = 4 * 1024 * 1024;

function isAllowedRemoteImageUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    return false;
  }

  return true;
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : "";
    const folder = typeof body?.folder === "string" ? body.folder : "uploads";
    const filename =
      typeof body?.filename === "string" ? body.filename : undefined;

    if (!imageUrl) {
      return NextResponse.json({ error: "No image URL provided" }, { status: 400 });
    }

    if (!isAllowedRemoteImageUrl(imageUrl)) {
      return NextResponse.json(
        { error: "Please drop a valid public image URL (http/https)" },
        { status: 400 }
      );
    }

    const url = await uploadImageFromUrl(imageUrl, folder, filename, {
      maxBytes: MAX_SIZE_BYTES,
      strictImageMime: true,
    });

    return NextResponse.json({
      success: true,
      url,
      uploadedBy: userId,
    });
  } catch (error) {
    console.error("Upload-from-url error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to upload image from URL";
    const isClientError =
      message.includes("image") ||
      message.includes("URL") ||
      message.includes("Failed to fetch image");
    return NextResponse.json(
      { error: message },
      { status: isClientError ? 400 : 500 }
    );
  }
}
