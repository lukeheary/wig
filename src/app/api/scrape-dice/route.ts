import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { inferCategoriesFromText } from "@/server/utils/inferCategories";

function parseAddress(address: string): { city: string; state: string } {
  const parts = address.split(",").map((s) => s.trim());

  let city = "";
  let state = "";

  if (parts.length >= 3) {
    city = parts[parts.length - 3];
    const stateZip = parts[parts.length - 2];
    const stateMatch = stateZip.match(/^([A-Z]{2})\s/);
    if (stateMatch) {
      state = stateMatch[1];
    }
  }

  if (!state) {
    const match = address.match(/\b([A-Z]{2})\s+\d{5}\b/);
    if (match) state = match[1];
  }

  return { city: city || "Unknown", state: state || "XX" };
}

export async function scrapeDice(url: string) {
  if (!url || !url.startsWith("https://dice.fm/venue/")) {
    throw new Error(
      "Invalid URL. Must be a Dice.fm venue URL (https://dice.fm/venue/...)"
    );
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch page: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const jsonLdScripts = $('script[type="application/ld+json"]');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let venueData: any = null;
  jsonLdScripts.each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const placeItem = items.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (item: any) => item["@type"] === "Place" && item.event
      );
      if (placeItem) {
        venueData = placeItem;
      }
    } catch {
      // skip invalid JSON
    }
  });

  if (!venueData) {
    throw new Error("No event data found on this page");
  }

  const { city, state } = parseAddress(venueData.address || "");
  const rawEvents = venueData.event;
  const eventArray = Array.isArray(rawEvents) ? rawEvents : [rawEvents];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = eventArray.map((event: any) => {
    const externalId =
      event.identifier?.value ||
      event.identifier ||
      event["@id"] ||
      event.url ||
      null;

    return {
      title: event.name || "Untitled Event",
      description: event.description || null,
      coverImageUrl: event.image?.[0] || null,
      eventUrl: event.url || null,
      externalId,
      startAt: event.startDate,
      endAt: event.endDate || null,
      venueName: venueData.name,
      address: venueData.address,
      city,
      state,
      categories: inferCategoriesFromText(
        event.name || "Untitled Event",
        event.description || null
      ),
      visibility: "public" as const,
      source: "dice" as const,
      eventStatus: event.eventStatus,
    };
  });

  return {
    venue: { name: venueData.name, address: venueData.address, city, state },
    events,
    totalEvents: events.length,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    const result = await scrapeDice(url);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid URL") ? 400
      : message.startsWith("No event data") ? 404
      : message.startsWith("Failed to fetch") ? 502
      : 500;
    return NextResponse.json({ error: `Scraping failed: ${message}` }, { status });
  }
}
