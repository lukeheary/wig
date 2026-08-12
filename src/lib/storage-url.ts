function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function configuredStorageBaseUrls(): URL[] {
  const values = [
    process.env.R2_PUBLIC_BASE_URL,
    process.env.R2_PUBLIC_URL,
    process.env.R2_ENDPOINT,
    process.env.AWS_S3_BUCKET && process.env.AWS_REGION
      ? `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`
      : undefined,
  ];

  return values.flatMap((value) => {
    if (!value) return [];
    try {
      return [new URL(`${trimTrailingSlashes(value)}/`)];
    } catch {
      return [];
    }
  });
}

function keyFromKnownStorageUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  for (const baseUrl of configuredStorageBaseUrls()) {
    if (parsed.origin !== baseUrl.origin) continue;

    const basePath = baseUrl.pathname.replace(/\/$/, "");
    if (basePath && !parsed.pathname.startsWith(`${basePath}/`)) continue;

    const key = parsed.pathname.slice(basePath.length).replace(/^\//, "");
    if (key) return decodeURIComponent(key);
  }

  return null;
}

/**
 * Convert one of our R2/S3 URLs to its provider-independent object key.
 * External URLs are intentionally preserved.
 */
export function normalizeStoredImageValue(value: string): string {
  const trimmed = value.trim();
  return keyFromKnownStorageUrl(trimmed) ?? trimmed.replace(/^\/(?!\/)/, "");
}

/**
 * Resolve a stored object key for clients while preserving legacy/external URLs.
 */
export function resolveStoredImageValue(value: string): string {
  const trimmed = value.trim();

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed;
    }
  } catch {
    // A non-URL value is an object key.
  }

  const publicBaseUrl =
    process.env.R2_PUBLIC_BASE_URL ||
    process.env.R2_PUBLIC_URL ||
    process.env.R2_ENDPOINT;

  if (!publicBaseUrl) return trimmed;
  return `${trimTrailingSlashes(publicBaseUrl)}/${trimmed.replace(/^\/+/, "")}`;
}
