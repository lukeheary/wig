import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  cities,
  events,
  metroAreas,
  placeFollows,
  places,
  users,
} from "@/server/db/schema";
import {
  createMobileMetroResolver,
  mobileMetroAreas,
} from "@/app/api/mobile/metro";

async function currentMobileUserId() {
  const { userId } = await auth();

  if (userId) {
    return userId;
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: {
      id: true,
    },
  });

  return previewUser?.id ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 200)
    : 100;

  const userId = await currentMobileUserId();

  const [currentUser, availableMetroAreas, cityCoordinates, placesList] =
    await Promise.all([
    userId
      ? db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: {
            city: true,
            state: true,
          },
        })
      : null,
    db
      .select({
        name: metroAreas.name,
        state: metroAreas.state,
        latitude: metroAreas.latitude,
        longitude: metroAreas.longitude,
        radiusMiles: metroAreas.radiusMiles,
      })
      .from(metroAreas)
      .orderBy(asc(metroAreas.name), asc(metroAreas.state)),
    db
      .select({
        name: cities.name,
        state: cities.state,
        latitude: cities.latitude,
        longitude: cities.longitude,
      })
      .from(cities),
    db.query.places.findMany({
      orderBy: [asc(places.name)],
      limit,
    }),
  ]);

  const resolveMetroArea = createMobileMetroResolver(
    availableMetroAreas,
    cityCoordinates
  );
  const availableCities = mobileMetroAreas(availableMetroAreas);
  const currentUserMetroArea =
    currentUser?.city && currentUser?.state
      ? resolveMetroArea({ city: currentUser.city, state: currentUser.state })
      : null;

  if (placesList.length === 0) {
    return NextResponse.json({
      places: [],
      availableCities,
      currentUserLocation: currentUserMetroArea,
    });
  }

  const placeIds = placesList.map((place) => place.id);
  const followedPlaceIds =
    userId && placeIds.length > 0
      ? new Set(
          (
            await db.query.placeFollows.findMany({
              where: and(
                eq(placeFollows.userId, userId),
                inArray(placeFollows.placeId, placeIds)
              ),
              columns: {
                placeId: true,
              },
            })
          ).map((follow) => follow.placeId)
        )
      : new Set<string>();

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
    const metroArea = resolveMetroArea({
      city: place.city,
      state: place.state,
    });

    return {
      id: place.id,
      type: place.type,
      slug: place.slug,
      name: place.name,
      logoImageUrl: place.logoImageUrl,
      city: place.city,
      state: place.state,
      metroAreaCity: metroArea?.city ?? null,
      metroAreaState: metroArea?.state ?? null,
      eventCount,
      upcomingEventCount: eventCount,
      updatedAt: place.updatedAt,
      isFollowed: followedPlaceIds.has(place.id),
    };
  });

  return NextResponse.json({
    places: payload,
    availableCities,
    currentUserLocation: currentUserMetroArea,
  });
}
