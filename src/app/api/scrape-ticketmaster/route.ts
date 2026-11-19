import { NextRequest, NextResponse } from "next/server";
import { scrapeTicketmaster } from "@/server/scrapers/providers/ticketmaster";

export async function POST(request: NextRequest) {
  try {
    const { venueName, stateCode, classificationName } = await request.json();

    if (!venueName || typeof venueName !== "string") {
      return NextResponse.json(
        { error: "venueName is required" },
        { status: 400 }
      );
    }

    if (!stateCode || typeof stateCode !== "string") {
      return NextResponse.json(
        { error: "stateCode is required" },
        { status: 400 }
      );
    }

    const result = await scrapeTicketmaster({
      venueName,
      stateCode,
      classificationName,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: `Scraping failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
