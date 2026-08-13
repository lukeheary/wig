import { getEnvironmentPrefix } from "./env";

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

const ENVIRONMENT_KEY_PREFIX = /^(?:production|development|test)\/+/;

function stripEnvironmentPrefix(key: string): string {
  return key.replace(/^\/+/, "").replace(ENVIRONMENT_KEY_PREFIX, "");
}

function addCurrentEnvironmentPrefix(key: string): string {
  const normalizedKey = key.replace(/^\/+/, "");
  if (ENVIRONMENT_KEY_PREFIX.test(normalizedKey)) return normalizedKey;
  return `${getEnvironmentPrefix()}/${normalizedKey}`;
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
  const knownStorageKey = keyFromKnownStorageUrl(trimmed);
  if (knownStorageKey) return stripEnvironmentPrefix(knownStorageKey);

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed;
    }
  } catch {
    // A non-URL value is an object key.
  }

  return stripEnvironmentPrefix(trimmed);
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

  // Prefer S3 while the R2 migration is in progress. The database remains
  // provider-independent, so switching this preference later requires no data
  // migration.
  const publicBaseUrl =
    process.env.AWS_S3_BUCKET && process.env.AWS_REGION
      ? `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`
      : process.env.R2_PUBLIC_BASE_URL ||
        process.env.R2_PUBLIC_URL ||
        process.env.R2_ENDPOINT;

  if (!publicBaseUrl) return trimmed;
  return `${trimTrailingSlashes(publicBaseUrl)}/${addCurrentEnvironmentPrefix(trimmed)}`;
}
