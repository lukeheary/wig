import { NextResponse } from "next/server";

type GoogleAutocompleteResponse = {
  predictions?: Array<{
    place_id?: string;
    structured_formatting?: {
      main_text?: string;
      secondary_text?: string;
    };
  }>;
  status?: string;
  error_message?: string;
};

type GoogleGeocodeResponse = {
  results?: Array<{
    place_id?: string;
    formatted_address?: string;
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
    types?: string[];
  }>;
  status?: string;
  error_message?: string;
};

function extractCityAndState(
  components: NonNullable<GoogleGeocodeResponse["results"]>[number]["address_components"] = []
) {
  let city = "";
  let state = "";

  for (const component of components) {
    if (component.types.includes("locality")) {
      city = component.long_name;
    }
    if (!city && component.types.includes("postal_town")) {
      city = component.long_name;
    }
    if (!city && component.types.includes("administrative_area_level_3")) {
      city = component.long_name;
    }
    if (component.types.includes("administrative_area_level_1")) {
      state = component.short_name;
    }
  }

  return { city, state };
}

function isCityLikeResult(result: NonNullable<GoogleGeocodeResponse["results"]>[number]) {
  const types = result.types ?? [];

  return (
    types.includes("locality") ||
    types.includes("postal_town") ||
    types.includes("administrative_area_level_3") ||
    types.includes("administrative_area_level_2")
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim() ?? "";
  const searchType = searchParams.get("searchType") === "cities" ? "cities" : "establishments";

  if (query.length < 2) {
    return NextResponse.json({ predictions: [] });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Places API key is not configured" },
      { status: 500 }
    );
  }

  if (searchType === "cities") {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", query);
    url.searchParams.set("components", "country:US");
    url.searchParams.set("key", apiKey);

    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json()) as GoogleGeocodeResponse;

    if (!response.ok || payload.status === "REQUEST_DENIED") {
      return NextResponse.json(
        { error: payload.error_message || "Failed to search Google city results" },
        { status: 500 }
      );
    }

    const seen = new Set<string>();
    const predictions = (payload.results ?? [])
      .filter((result) => result.place_id && isCityLikeResult(result))
      .map((result) => {
        const { city, state } = extractCityAndState(result.address_components);
        const primaryText = city || result.formatted_address?.split(",")[0]?.trim() || "";
        const secondaryText = state
          ? `${state}, USA`
          : result.formatted_address
              ?.split(",")
              .slice(1)
              .join(",")
              .trim() || null;

        return {
          placeId: result.place_id!,
          primaryText,
          secondaryText,
          dedupeKey: `${primaryText}|${state}`,
        };
      })
      .filter((prediction) => {
        if (!prediction.primaryText) {
          return false;
        }
        if (seen.has(prediction.dedupeKey)) {
          return false;
        }
        seen.add(prediction.dedupeKey);
        return true;
      })
      .map(({ dedupeKey: _dedupeKey, ...prediction }) => prediction);

    return NextResponse.json({ predictions });
  }

  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/autocomplete/json"
  );
  url.searchParams.set("input", query);
  url.searchParams.set("types", "establishment");
  url.searchParams.set("components", "country:us");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json()) as GoogleAutocompleteResponse;

  if (!response.ok || payload.status === "REQUEST_DENIED") {
    return NextResponse.json(
      { error: payload.error_message || "Failed to search Google Places" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    predictions: (payload.predictions ?? [])
      .filter((prediction) => prediction.place_id && prediction.structured_formatting?.main_text)
      .map((prediction) => ({
        placeId: prediction.place_id,
        primaryText: prediction.structured_formatting?.main_text ?? "",
        secondaryText: prediction.structured_formatting?.secondary_text ?? null,
      })),
  });
}
