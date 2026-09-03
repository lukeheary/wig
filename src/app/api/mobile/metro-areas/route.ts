import { asc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { closestMetroForCoordinates } from "@/app/api/mobile/metro";
import { db } from "@/server/db";
import { metroAreas } from "@/server/db/schema";

export async function GET(request: NextRequest) {
  try {
    const metros = await db
      .select({
        id: metroAreas.id,
        name: metroAreas.name,
        state: metroAreas.state,
        latitude: metroAreas.latitude,
        longitude: metroAreas.longitude,
        radiusMiles: metroAreas.radiusMiles,
        isEnabled: metroAreas.isEnabled,
      })
      .from(metroAreas)
      .where(eq(metroAreas.isEnabled, true))
      .orderBy(asc(metroAreas.name), asc(metroAreas.state));

    const latitude = Number(request.nextUrl.searchParams.get("latitude"));
    const longitude = Number(request.nextUrl.searchParams.get("longitude"));
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);

    const matchedMetro = hasCoordinates
      ? closestMetroForCoordinates(latitude, longitude, metros)
      : null;

    return NextResponse.json({
      metroAreas: metros.map((metro) => ({
        id: metro.id,
        name: metro.name,
        state: metro.state,
      })),
      matchedMetroArea: matchedMetro
        ? {
            id: matchedMetro.id,
            name: matchedMetro.city,
            state: matchedMetro.state,
          }
        : null,
    });
  } catch (error) {
    console.error("GET /api/mobile/metro-areas failed", error);
    return NextResponse.json(
      { error: "Failed to load available locations." },
      { status: 500 }
    );
  }
}
