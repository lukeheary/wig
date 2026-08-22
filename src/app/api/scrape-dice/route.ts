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

const DICE_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

type DiceEventDetails = {
  description: string | null;
  externalId: string | null;
};

function diceIdFromValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const directId = trimmed.match(/^[a-f0-9]{24}$/i)?.[0];
  if (directId) return directId.toLowerCase();

  try {
    const pathname = new URL(trimmed).pathname.replace(/\/+$/, "");
    return (
      pathname.match(/^\/event\/([a-f0-9]{24})$/i)?.[1].toLowerCase() ?? null
    );
  } catch {
    return null;
  }
}

function readEventDetails(html: string): DiceEventDetails {
  const $ = cheerio.load(html);
  let jsonLdDescription: string | null = null;
  const retailerId = diceIdFromValue(
    $('meta[property="product:retailer_item_id"]').attr("content")
  );
  const appLinkId = diceIdFromValue(
    $('meta[property="al:ios:url"], meta[property="al:android:url"]')
      .first()
      .attr("content")
      ?.match(/\/events\/([a-f0-9]{24})/i)?.[1]
  );
  const externalId = retailerId ?? appLinkId;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (jsonLdDescription) return;

    try {
      const parsed = JSON.parse($(el).text());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const event = items.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (item: any) =>
          typeof item?.["@type"] === "string" &&
          item["@type"].endsWith("Event") &&
          item.description
      );
      if (typeof event?.description === "string") {
        jsonLdDescription = event.description.trim() || null;
      }
    } catch {
      // skip invalid JSON
    }
  });

  if (jsonLdDescription) {
    return { description: jsonLdDescription, externalId };
  }

  // Dice no longer includes descriptions in the venue page's Event JSON-LD.
  // The event detail page exposes the About copy behind this stable test id.
  const about = $('[data-testid="event-details-about-text"]');
  if (!about.length) return { description: null, externalId };

  const paragraphs = about
    .find("p")
    .toArray()
    .map((paragraph) => $(paragraph).text().trim())
    .filter(Boolean);
  const description = paragraphs.length
    ? paragraphs.join("\n\n")
    : about.clone().find("button").remove().end().text().trim();

  return { description: description || null, externalId };
}

async function fetchEventDetails(url: string): Promise<DiceEventDetails> {
  try {
    const response = await fetch(url, {
      headers: DICE_REQUEST_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { description: null, externalId: null };
    return readEventDetails(await response.text());
  } catch {
    // Missing detail data should not cause the entire venue scrape to fail.
    return { description: null, externalId: null };
  }
}

export async function scrapeDice(url: string) {
  if (!url || !url.startsWith("https://dice.fm/venue/")) {
    throw new Error(
      "Invalid URL. Must be a Dice.fm venue URL (https://dice.fm/venue/...)"
    );
  }

  const response = await fetch(url, {
    headers: DICE_REQUEST_HEADERS,
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
  const events = await Promise.all(
    eventArray.map(async (event: any) => {
      const embeddedExternalId =
        diceIdFromValue(event.identifier?.value) ??
        diceIdFromValue(event.identifier) ??
        diceIdFromValue(event["@id"]) ??
        diceIdFromValue(event.url);
      const eventDetails =
        typeof event.url === "string" &&
        (!embeddedExternalId || !event.description)
          ? await fetchEventDetails(event.url)
          : { description: null, externalId: null };
      const externalId =
        embeddedExternalId ?? eventDetails.externalId ?? event.url ?? null;
      const description =
        (typeof event.description === "string" && event.description.trim()) ||
        eventDetails.description;

      return {
        title: event.name || "Untitled Event",
        description,
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
          description
        ),
        visibility: "public" as const,
        source: "dice" as const,
        eventStatus: event.eventStatus,
      };
    })
  );

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
