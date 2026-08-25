import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { getStoragePath } from "./env";
import { generateNanoId } from "./nano-id";

const R2_BUCKET = process.env.R2_BUCKET!;
const rawR2Endpoint = process.env.R2_ENDPOINT!;

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function getR2ApiEndpoint(endpoint: string, bucket: string): string {
  const parsed = new URL(endpoint);
  const bucketSuffix = `/${bucket}`;

  if (trimTrailingSlashes(parsed.pathname).endsWith(bucketSuffix)) {
    parsed.pathname = trimTrailingSlashes(parsed.pathname).slice(
      0,
      -bucketSuffix.length
    );
  }

  return trimTrailingSlashes(parsed.toString());
}

function getR2PublicBaseUrl(endpoint: string, bucket: string): string {
  const configuredPublicUrl =
    process.env.R2_PUBLIC_BASE_URL || process.env.R2_PUBLIC_URL;
  if (configuredPublicUrl) return trimTrailingSlashes(configuredPublicUrl);

  const normalizedEndpoint = trimTrailingSlashes(endpoint);
  return normalizedEndpoint.endsWith(`/${bucket}`)
    ? normalizedEndpoint
    : `${normalizedEndpoint}/${bucket}`;
}

const R2_PUBLIC_BASE_URL = getR2PublicBaseUrl(rawR2Endpoint, R2_BUCKET);
const R2_PUBLIC_URL = new URL(`${R2_PUBLIC_BASE_URL}/`);
const LEGACY_AWS_PUBLIC_URLS = [
  new URL("https://whoisgoing.s3.us-east-2.amazonaws.com/"),
  ...(process.env.AWS_S3_BUCKET && process.env.AWS_REGION
    ? [
        new URL(
          `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/`
        ),
      ]
    : []),
];

// Cloudflare R2 exposes an S3-compatible API, so the AWS SDK remains the client.
export const r2Client = new S3Client({
  region: process.env.R2_REGION || "auto",
  endpoint: getR2ApiEndpoint(rawR2Endpoint, R2_BUCKET),
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export const BUCKET_NAME = R2_BUCKET;

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

const JPEG_OPTIONS = {
  quality: 82,
  mozjpeg: true,
} as const;

const USER_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_USER_IMAGE_DIMENSION = 12_000;
const MAX_USER_IMAGE_PIXELS = 40_000_000;

export class UserImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserImageValidationError";
  }
}

export function isUserImageValidationError(
  error: unknown
): error is UserImageValidationError {
  return error instanceof UserImageValidationError;
}

/** Decode user uploads before storage and reject disguised or oversized images. */
export async function validateUserImageFile(file: File): Promise<void> {
  if (!USER_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) {
    throw new UserImageValidationError(
      "Please upload a JPEG, PNG, or WebP image"
    );
  }

  try {
    const metadata = await sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: MAX_USER_IMAGE_PIXELS,
    }).metadata();
    if (!metadata.width || !metadata.height)
      throw new Error("Missing dimensions");
    if (
      metadata.width > MAX_USER_IMAGE_DIMENSION ||
      metadata.height > MAX_USER_IMAGE_DIMENSION ||
      metadata.width * metadata.height > MAX_USER_IMAGE_PIXELS
    ) {
      throw new UserImageValidationError("Image dimensions are too large");
    }
  } catch (error) {
    if (isUserImageValidationError(error)) throw error;
    throw new UserImageValidationError(
      "The selected file is not a valid image"
    );
  }
}

function hasJpegExtension(fileName: string | undefined): boolean {
  return /\.jpe?g$/i.test(fileName ?? "");
}

function hasPngExtension(fileName: string | undefined): boolean {
  return /\.png$/i.test(fileName ?? "");
}

async function jpegBuffer(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .jpeg(JPEG_OPTIONS)
    .toBuffer();
}

async function pngBuffer(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).rotate().png({ compressionLevel: 9 }).toBuffer();
}

/** Generate an immutable image filename while preserving its extension. */
export function generateUniqueFilename(originalName: string): string {
  const extension = originalName.split(".").pop()?.toLowerCase() || "jpg";
  return `${generateNanoId()}.${extension}`;
}

/**
 * Get the public R2 URL for a stored object.
 *
 * The legacy function name is retained to avoid changing every caller.
 */
export function getS3Url(key: string): string {
  return new URL(key.replace(/^\/+/, ""), R2_PUBLIC_URL).toString();
}

function keyFromBaseUrl(url: string, baseUrl: URL): string | null {
  const parsed = new URL(url);
  const basePath = baseUrl.pathname.replace(/\/$/, "");

  if (
    parsed.origin !== baseUrl.origin ||
    parsed.pathname === basePath ||
    !parsed.pathname.startsWith(`${basePath}/`)
  ) {
    return null;
  }

  return decodeURIComponent(
    parsed.pathname.slice(basePath.length).replace(/^\//, "")
  );
}

function getStorageKey(url: string): string | null {
  try {
    return (
      keyFromBaseUrl(url, R2_PUBLIC_URL) ||
      LEGACY_AWS_PUBLIC_URLS.reduce<string | null>(
        (key, baseUrl) => key || keyFromBaseUrl(url, baseUrl),
        null
      )
    );
  } catch {
    return null;
  }
}

/**
 * Check whether a URL points at the configured R2 public origin.
 */
export function isStorageUrl(url: string): boolean {
  return getStorageKey(url) !== null;
}

/**
 * Detect a legacy temporary upload without treating unrelated external URLs
 * containing the word "pending" as one of our objects.
 */
export function isPendingStorageUrl(url: string): boolean {
  const key = getStorageKey(url);
  return key?.split("/").includes("pending") ?? false;
}

async function writeToStorage(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
}

async function readFromStorage(key: string): Promise<{
  body: Buffer;
  contentType: string;
}> {
  const object = await r2Client.send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
  );
  if (!object.Body) throw new Error("Storage object has no body");

  return {
    body: Buffer.from(await object.Body.transformToByteArray()),
    contentType: object.ContentType || "image/png",
  };
}

/**
 * Copy an existing R2 object to a new environment-relative key. The source is
 * not deleted until the caller has persisted the new database value.
 */
export async function copyStorageObject(
  sourceUrl: string,
  targetFolder: string,
  targetFileName: string
): Promise<string> {
  const sourceKey = getStorageKey(sourceUrl);
  if (!sourceKey) throw new Error("Invalid source storage URL");

  const targetKey = `${getStoragePath(targetFolder)}/${targetFileName}`;
  const source = await readFromStorage(sourceKey);
  await writeToStorage(targetKey, source.body, source.contentType);

  return getS3Url(targetKey);
}

/**
 * Convert a stored image to JPEG and write it to a new R2 key.
 * Existing JPEG bytes are copied without recompression.
 */
export async function convertStorageImageToJpeg(
  sourceUrl: string,
  targetFolder: string,
  targetFileName: string
): Promise<string> {
  const sourceKey = getStorageKey(sourceUrl);
  if (!sourceKey) throw new Error("Invalid source storage URL");

  const targetKey = `${getStoragePath(targetFolder)}/${targetFileName}`;
  const source = await readFromStorage(sourceKey);
  const metadata = await sharp(source.body).metadata();
  const body =
    metadata.format === "jpeg" ? source.body : await jpegBuffer(source.body);

  await writeToStorage(targetKey, body, "image/jpeg");
  return getS3Url(targetKey);
}

/**
 * Convert a stored image to PNG and write it to a new R2 key.
 * Existing PNG bytes are copied without recompression.
 */
export async function convertStorageImageToPng(
  sourceUrl: string,
  targetFolder: string,
  targetFileName: string
): Promise<string> {
  const sourceKey = getStorageKey(sourceUrl);
  if (!sourceKey) throw new Error("Invalid source storage URL");

  const targetKey = `${getStoragePath(targetFolder)}/${targetFileName}`;
  const source = await readFromStorage(sourceKey);
  const metadata = await sharp(source.body).metadata();
  const body =
    metadata.format === "png" ? source.body : await pngBuffer(source.body);

  await writeToStorage(targetKey, body, "image/png");
  return getS3Url(targetKey);
}

/**
 * Upload a file to R2 and return its public R2 URL.
 * Automatically adds environment prefix (production/development) to the path
 */
export async function uploadToS3(
  file: File,
  folder: string = "uploads",
  fileName?: string
): Promise<string> {
  await validateUserImageFile(file);

  // User uploads are decoded and re-encoded, stripping metadata and ensuring
  // that stored bytes match their advertised image format.
  const usePng = hasPngExtension(fileName || file.name);
  const filename = generateUniqueFilename(usePng ? "image.png" : "image.jpg");
  const fullPath = getStoragePath(folder);
  const key = `${fullPath}/${filename}`;

  const arrayBuffer = await file.arrayBuffer();
  let buffer: Buffer = Buffer.from(arrayBuffer);
  let contentType: string;

  if (usePng) {
    buffer = await pngBuffer(buffer);
    contentType = "image/png";
  } else {
    buffer = await jpegBuffer(buffer);
    contentType = "image/jpeg";
  }

  await writeToStorage(key, buffer, contentType);

  return getS3Url(key);
}

/**
 * Download an image from a URL and upload it to R2.
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
    throw new Error(`Image is too large (max ${maxMb}MB)`);
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

  const filename = generateUniqueFilename(fileName || `image.${ext}`);
  const fullPath = getStoragePath(folder);
  const key = `${fullPath}/${filename}`;

  const arrayBuffer = await response.arrayBuffer();
  if (maxBytes && arrayBuffer.byteLength > maxBytes) {
    const maxMb = (maxBytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "");
    throw new Error(`Image is too large (max ${maxMb}MB)`);
  }
  let buffer: Buffer = Buffer.from(arrayBuffer);
  let outputContentType = contentType;

  if (hasJpegExtension(filename)) {
    buffer = await jpegBuffer(buffer);
    outputContentType = "image/jpeg";
  } else if (hasPngExtension(filename)) {
    buffer = await pngBuffer(buffer);
    outputContentType = "image/png";
  }

  await writeToStorage(key, buffer, outputContentType);

  return getS3Url(key);
}

/**
 * Delete a file from R2.
 */
export async function deleteFromS3(url: string): Promise<void> {
  const key = getStorageKey(url);
  if (!key) {
    throw new Error("Invalid storage URL");
  }

  await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}
