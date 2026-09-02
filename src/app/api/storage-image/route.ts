import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { BUCKET_NAME, getS3Url, r2Client } from "@/lib/s3";

export const dynamic = "force-dynamic";

function normalizedStorageKey(value: string | null): string | null {
  if (!value) return null;

  const key = value.replace(/^\/+/, "");
  if (
    !key ||
    key.includes("\0") ||
    key.split("/").some((segment) => segment === "..") ||
    /^(?:production|development|test)\//.test(key)
  ) {
    return null;
  }

  return key;
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await r2Client.send(
      new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name;

    if (status === 404 || name === "NotFound" || name === "NoSuchKey") {
      return false;
    }

    throw error;
  }
}

function storageRedirect(key: string): NextResponse {
  const response = NextResponse.redirect(getS3Url(key), 307);
  response.headers.set(
    "Cache-Control",
    "public, max-age=300, s-maxage=300, stale-while-revalidate=60"
  );
  return response;
}

export async function GET(request: NextRequest) {
  const key = normalizedStorageKey(request.nextUrl.searchParams.get("key"));
  if (!key) {
    return NextResponse.json({ error: "Invalid storage key" }, { status: 400 });
  }

  const developmentKey = `development/${key}`;
  if (await objectExists(developmentKey)) {
    return storageRedirect(developmentKey);
  }

  const productionKey = `production/${key}`;
  if (await objectExists(productionKey)) {
    return storageRedirect(productionKey);
  }

  return NextResponse.json({ error: "Image not found" }, { status: 404 });
}
