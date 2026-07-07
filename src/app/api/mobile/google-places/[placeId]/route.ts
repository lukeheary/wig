import { NextResponse } from "next/server";

type GooglePlaceDetailsResponse = {
  result?: {
    name?: string;
    formatted_address?: string;
    website?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
    opening_hours?: {
      periods?: Array<{
        open?: { day?: number; time?: string };
        close?: { day?: number; time?: string };
      }>;
    };
  };
  status?: string;
  error_message?: string;
};

type GoogleGeocodeResponse = {
  results?: Array<{
    place_id?: string;
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }>;
  status?: string;
  error_message?: string;
};

type GoogleOpeningHours = NonNullable<
  GooglePlaceDetailsResponse["result"]
>["opening_hours"];

const dayMap: Record<number, keyof VenueHoursPayload> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

type DayHoursPayload = {
  open: string;
  close: string;
  closed: boolean;
};

type VenueHoursPayload = {
  monday?: DayHoursPayload;
  tuesday?: DayHoursPayload;
  wednesday?: DayHoursPayload;
  thursday?: DayHoursPayload;
  friday?: DayHoursPayload;
  saturday?: DayHoursPayload;
  sunday?: DayHoursPayload;
};

function formatGoogleTime(time: string) {
  return `${time.slice(0, 2)}:${time.slice(2)}`;
}

function mapOpeningHours(
  openingHours?: GoogleOpeningHours
): VenueHoursPayload | null {
  const periods = openingHours?.periods;
  if (!periods?.length) {
    return null;
  }

  const is247 =
    periods.length === 1 &&
    periods[0]?.open?.time === "0000" &&
    !periods[0]?.close;

  const hours: VenueHoursPayload = {};

  for (const dayName of Object.values(dayMap)) {
    hours[dayName] = {
      open: "09:00",
      close: "17:00",
      closed: true,
    };
  }

  if (is247) {
    for (const dayName of Object.values(dayMap)) {
      hours[dayName] = {
        open: "00:00",
        close: "23:59",
        closed: false,
      };
    }

    return hours;
  }

  for (const period of periods) {
    const dayNum = period.open?.day;
    const dayName = dayNum == null ? null : dayMap[dayNum];
    if (!dayName) {
      continue;
    }

    hours[dayName] = {
      open: period.open?.time ? formatGoogleTime(period.open.time) : "09:00",
      close: period.close?.time ? formatGoogleTime(period.close.time) : "23:59",
      closed: false,
    };
  }

  return hours;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ placeId: string }> }
) {
  const { placeId } = await params;
  const { searchParams } = new URL(request.url);
  const searchType =
    searchParams.get("searchType") === "cities" ? "cities" : "establishments";
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Places API key is not configured" },
      { status: 500 }
    );
  }

  if (searchType === "cities") {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("key", apiKey);

    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json()) as GoogleGeocodeResponse;

    if (!response.ok || payload.status === "REQUEST_DENIED") {
      return NextResponse.json(
        { error: payload.error_message || "Failed to load Google city details" },
        { status: 500 }
      );
    }

    const result = payload.results?.[0];
    if (!result?.address_components) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    let city = "";
    let state = "";

    for (const component of result.address_components) {
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

    return NextResponse.json({
      placeId,
      name: city || result.formatted_address?.split(",")[0]?.trim() || "",
      address: "",
      city,
      state,
      formattedAddress: result.formatted_address ?? "",
      website: null,
      hours: null,
      latitude: result.geometry?.location?.lat ?? null,
      longitude: result.geometry?.location?.lng ?? null,
    });
  }

  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/details/json"
  );
  url.searchParams.set("place_id", placeId);
  url.searchParams.set(
    "fields",
    (
      searchType === "cities"
        ? ["address_components", "formatted_address", "geometry", "name"]
        : [
            "address_components",
            "formatted_address",
            "geometry",
            "name",
            "opening_hours",
            "website",
          ]
    ).join(",")
  );
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json()) as GooglePlaceDetailsResponse;

  if (!response.ok || payload.status === "REQUEST_DENIED") {
    return NextResponse.json(
      { error: payload.error_message || "Failed to load Google Place details" },
      { status: 500 }
    );
  }

  const place = payload.result;
  if (!place?.address_components || !place.name) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  let streetNumber = "";
  let route = "";
  let city = "";
  let state = "";

  for (const component of place.address_components) {
    if (component.types.includes("street_number")) {
      streetNumber = component.long_name;
    }
    if (component.types.includes("route")) {
      route = component.long_name;
    }
    if (component.types.includes("locality")) {
      city = component.long_name;
    }
    if (!city && component.types.includes("postal_town")) {
      city = component.long_name;
    }
    if (!city && component.types.includes("administrative_area_level_2")) {
      city = component.long_name;
    }
    if (component.types.includes("administrative_area_level_1")) {
      state = component.short_name;
    }
  }

  return NextResponse.json({
    placeId,
    name: place.name,
    address: `${streetNumber} ${route}`.trim(),
    city,
    state,
    formattedAddress: place.formatted_address ?? "",
    website: place.website ?? null,
    hours: mapOpeningHours(place.opening_hours),
    latitude: place.geometry?.location?.lat ?? null,
    longitude: place.geometry?.location?.lng ?? null,
  });
}
