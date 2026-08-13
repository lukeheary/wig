import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getStoragePath } from "./env";

const R2_BUCKET = process.env.R2_BUCKET!;
const rawR2Endpoint = process.env.R2_ENDPOINT!;
const AWS_BUCKET = process.env.AWS_S3_BUCKET!;
const AWS_REGION = process.env.AWS_REGION!;

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
const AWS_PUBLIC_URL = new URL(
  `https://${AWS_BUCKET}.s3.${AWS_REGION}.amazonaws.com/`
);

// Cloudflare R2 exposes an S3-compatible API, so the AWS SDK remains the client.
export const r2Client = new S3Client({
  region: process.env.R2_REGION || "auto",
  endpoint: getR2ApiEndpoint(rawR2Endpoint, R2_BUCKET),
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export const awsS3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export const BUCKET_NAME = R2_BUCKET;

const STORAGE_TARGETS = [
  { name: "R2", client: r2Client, bucket: R2_BUCKET },
  { name: "S3", client: awsS3Client, bucket: AWS_BUCKET },
] as const;

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
 * Get the preferred public URL for a stored object. Objects are dual-written,
 * but S3 is the read origin while the R2 migration is in progress.
 */
export function getS3Url(key: string): string {
  return new URL(key.replace(/^\/+/, ""), AWS_PUBLIC_URL).toString();
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
      keyFromBaseUrl(url, AWS_PUBLIC_URL)
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

async function writeToBothStorageProviders(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const results = await Promise.allSettled(
    STORAGE_TARGETS.map(({ client, bucket }) =>
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      )
    )
  );
  const failedWrites = results
    .map((result, index) => ({ result, target: STORAGE_TARGETS[index] }))
    .filter(
      (
        item
      ): item is {
        result: PromiseRejectedResult;
        target: (typeof STORAGE_TARGETS)[number];
      } => item.result.status === "rejected"
    );

  if (failedWrites.length === 0) return;

  // Best-effort rollback prevents a reported failure from silently leaving only
  // one provider with the object.
  await Promise.allSettled(
    results.flatMap((result, index) =>
      result.status === "fulfilled"
        ? [
            STORAGE_TARGETS[index]!.client.send(
              new DeleteObjectCommand({
                Bucket: STORAGE_TARGETS[index]!.bucket,
                Key: key,
              })
            ),
          ]
        : []
    )
  );

  throw new AggregateError(
    failedWrites.map(({ result }) => result.reason),
    `Image upload failed for ${failedWrites.map(({ target }) => target.name).join(" and ")}`
  );
}

async function readFromEitherStorageProvider(key: string): Promise<{
  body: Buffer;
  contentType: string;
}> {
  const failures: unknown[] = [];

  for (const { client, bucket } of STORAGE_TARGETS) {
    try {
      const object = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      if (!object.Body) throw new Error("Storage object has no body");

      return {
        body: Buffer.from(await object.Body.transformToByteArray()),
        contentType: object.ContentType || "image/png",
      };
    } catch (error) {
      failures.push(error);
    }
  }

  throw new AggregateError(
    failures,
    `Could not read ${key} from R2 or S3`
  );
}

/**
 * Copy an existing R2/S3 object to a new environment-relative key in both
 * providers. The source is not deleted until the caller has persisted the new
 * database value.
 */
export async function copyStorageObject(
  sourceUrl: string,
  targetFolder: string,
  targetFileName: string
): Promise<string> {
  const sourceKey = getStorageKey(sourceUrl);
  if (!sourceKey) throw new Error("Invalid source storage URL");

  const targetKey = `${getStoragePath(targetFolder)}/${targetFileName}`;
  const source = await readFromEitherStorageProvider(sourceKey);
  await writeToBothStorageProviders(
    targetKey,
    source.body,
    source.contentType
  );

  return getS3Url(targetKey);
}

/**
 * Upload a file to R2 and S3, returning the preferred S3 public URL.
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

  await writeToBothStorageProviders(key, buffer, file.type);

  return getS3Url(key);
}

/**
 * Download an image from a URL and upload it to R2 and S3.
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

  await writeToBothStorageProviders(key, buffer, contentType);

  return getS3Url(key);
}

/**
 * Delete a file from both R2 and S3.
 */
export async function deleteFromS3(url: string): Promise<void> {
  const key = getStorageKey(url);
  if (!key) {
    throw new Error("Invalid storage URL");
  }

  const results = await Promise.allSettled(
    STORAGE_TARGETS.map(({ client, bucket }) =>
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    )
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      "Failed to delete image from every storage provider"
    );
  }
}
