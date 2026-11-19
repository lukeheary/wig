import { NextRequest, NextResponse } from "next/server";
import {
  scrapePosh,
  type PrefetchedPoshGroup,
} from "@/server/scrapers/providers/posh";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { urls, prefetchedGroups } = (await request.json()) as {
      urls: string[];
      prefetchedGroups?: PrefetchedPoshGroup[];
    };

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: "Please provide an array of Posh event URLs" },
        { status: 400 }
      );
    }

    const validPrefetchedGroups = Array.isArray(prefetchedGroups)
      ? prefetchedGroups.filter(
          (item) =>
            item &&
            typeof item.groupUrl === "string" &&
            item.groupUrl.includes("posh.vip/g/") &&
            item.data !== undefined
        )
      : [];

    const result = await scrapePosh(urls, validPrefetchedGroups);

    if (result.events.length === 0) {
      console.error("[posh-scraper] Failed to scrape any events", {
        urls,
        details: result.errors,
      });
      return NextResponse.json(
        { error: "Failed to scrape any events", details: result.errors },
        { status: 502 }
      );
    }

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
