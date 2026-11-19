import { NextRequest, NextResponse } from "next/server";
import { scrapeDice } from "@/server/scrapers/providers/dice";

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    const result = await scrapeDice(url);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid URL")
      ? 400
      : message.startsWith("No event data")
        ? 404
        : message.startsWith("Failed to fetch")
          ? 502
          : 500;
    return NextResponse.json(
      { error: `Scraping failed: ${message}` },
      { status }
    );
  }
}
