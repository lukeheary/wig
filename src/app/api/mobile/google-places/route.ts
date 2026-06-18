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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim() ?? "";

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
