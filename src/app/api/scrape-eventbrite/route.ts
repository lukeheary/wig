import { NextRequest, NextResponse } from "next/server";
import { scrapeEventbrite } from "@/server/scrapers/providers/eventbrite";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    return NextResponse.json(await scrapeEventbrite(body.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid URL") ? 400 : 502;
    return NextResponse.json(
      { error: `Scraping failed: ${message}` },
      { status }
    );
  }
}
