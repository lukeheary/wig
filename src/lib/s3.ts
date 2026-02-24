import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getStoragePath } from "./env";

// Initialize S3 client
export const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export const BUCKET_NAME = process.env.AWS_S3_BUCKET!;

const IMAGE_CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const IMAGE_EXT_TO_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/**
 * Generate a unique filename with timestamp and random string
 */
export function generateUniqueFilename(originalName: string): string {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const extension = originalName.split(".").pop();
  return `${timestamp}-${randomString}.${extension}`;
}

/**
 * Get the public URL for an S3 object
 */
export function getS3Url(key: string): string {
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

/**
 * Upload a file to S3
 * Automatically adds environment prefix (production/development) to the path
 */
export async function uploadToS3(
  file: File,
  folder: string = "uploads",
  fileName?: string
): Promise<string> {
  const filename = fileName || generateUniqueFilename(file.name);
  const fullPath = getStoragePath(folder);
  const key = `${fullPath}/${filename}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: file.type,
  });

  await s3Client.send(command);

  return getS3Url(key);
}

/**
 * Download an image from a URL and upload it to S3.
 * Useful for re-hosting scraped event images on our own bucket.
 */
export async function uploadImageFromUrl(
  imageUrl: string,
  folder: string = "events",
  fileName?: string,
  options?: {
    maxBytes?: number;
    strictImageMime?: boolean;
  }
): Promise<string> {
  const response = await fetch(imageUrl, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const rawContentType =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
    "";
  const contentLength = Number(response.headers.get("content-length") || "0");
  const maxBytes = options?.maxBytes;

  if (maxBytes && contentLength > maxBytes) {
    const maxMb = (maxBytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "");
    throw new Error(
      `Image is too large (max ${maxMb}MB)`
    );
  }

  let inferredExt: string | null = null;
  try {
    const parsedUrl = new URL(imageUrl);
    const pathname = parsedUrl.pathname.toLowerCase();
    const extMatch = pathname.match(/\.([a-z0-9]+)$/);
    const ext = extMatch?.[1] || null;
    if (ext && IMAGE_EXT_TO_CONTENT_TYPE[ext]) {
      inferredExt = ext;
    }
  } catch {
    // Ignore URL parsing errors here; fetch above already validated basic URL shape.
  }

  const hasImageMime = rawContentType.startsWith("image/");
  if (options?.strictImageMime && !hasImageMime && !inferredExt) {
    throw new Error("Dropped URL does not appear to be an image");
  }

  const contentType = hasImageMime
    ? rawContentType
    : inferredExt
      ? IMAGE_EXT_TO_CONTENT_TYPE[inferredExt]
      : "image/jpeg";

  // Determine extension from content type
  const ext = IMAGE_CONTENT_TYPE_TO_EXT[contentType] || inferredExt || "jpg";

  const filename =
    fileName || generateUniqueFilename(`image.${ext}`);
  const fullPath = getStoragePath(folder);
  const key = `${fullPath}/${filename}`;

  const arrayBuffer = await response.arrayBuffer();
  if (maxBytes && arrayBuffer.byteLength > maxBytes) {
    const maxMb = (maxBytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "");
    throw new Error(
      `Image is too large (max ${maxMb}MB)`
    );
  }
  const buffer = Buffer.from(arrayBuffer);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  return getS3Url(key);
}

/**
 * Delete a file from S3
 */
export async function deleteFromS3(url: string): Promise<void> {
  // Extract key from URL
  const urlParts = url.split(".amazonaws.com/");
  if (urlParts.length !== 2) {
    throw new Error("Invalid S3 URL");
  }

  const key = urlParts[1];

  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}
