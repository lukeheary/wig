import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { events, places } from "@/server/db/schema";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 200)
    : 100;

  const placesList = await db.query.places.findMany({
    orderBy: [asc(places.name)],
    limit,
  });

  if (placesList.length === 0) {
    return NextResponse.json([]);
  }

  const placeIds = placesList.map((place) => place.id);
  const now = new Date();

  const venueCounts = await db
    .select({
      placeId: events.venueId,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(
      and(
        inArray(events.venueId, placeIds),
        eq(events.visibility, "public"),
        eq(events.status, "active"),
        gte(events.startAt, now)
      )
    )
    .groupBy(events.venueId);

  const organizerCounts = await db
    .select({
      placeId: events.organizerId,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(
      and(
        inArray(events.organizerId, placeIds),
        eq(events.visibility, "public"),
        eq(events.status, "active"),
        gte(events.startAt, now)
      )
    )
    .groupBy(events.organizerId);

  const countByPlaceId = new Map<string, number>();

  for (const row of venueCounts) {
    if (row.placeId) {
      countByPlaceId.set(
        row.placeId,
        (countByPlaceId.get(row.placeId) ?? 0) + row.count
      );
    }
  }

  for (const row of organizerCounts) {
    if (row.placeId) {
      countByPlaceId.set(
        row.placeId,
        (countByPlaceId.get(row.placeId) ?? 0) + row.count
      );
    }
  }

  const payload = placesList.map((place) => {
    const eventCount = countByPlaceId.get(place.id) ?? 0;

    return {
      id: place.id,
      type: place.type,
      name: place.name,
      logoImageUrl: place.logoImageUrl,
      city: place.city,
      state: place.state,
      eventCount,
      upcomingEventCount: eventCount,
      updatedAt: place.updatedAt,
    };
  });

  return NextResponse.json(payload);
}
