import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { events, placeFollows, places, userFriends, users } from "@/server/db/schema";
import { mapEventCategoryData } from "@/server/utils/categories";
import { accentInsensitiveLike } from "@/server/db/search";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query")?.trim() ?? "";
    const limitParam = Number(searchParams.get("limit") ?? "12");
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 30)
      : 12;

    if (!query) {
      return NextResponse.json({ events: [], users: [], places: [] });
    }

    const { userId } = await auth();
    const matchedUsers = userId
      ? await db.query.userFriends.findMany({
          where: or(
            eq(userFriends.userId, userId),
            eq(userFriends.friendUserId, userId)
          ),
          columns: {
            id: true,
            userId: true,
            friendUserId: true,
            status: true,
          },
        })
      : [];

    const matchingUsers = userId
      ? await db.query.users.findMany({
        where: and(
          eq(users.isOnboarding, false),
          ne(users.id, userId),
          or(
              accentInsensitiveLike(users.username, query),
              accentInsensitiveLike(users.firstName, query, {
                coalesceToEmpty: true,
              }),
              accentInsensitiveLike(users.lastName, query, {
                coalesceToEmpty: true,
              })
          )
        ),
          columns: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatarImageUrl: true,
          },
          limit,
        })
      : [];

    const friendStatusByUserId = new Map<string, "accepted" | "pending_sent" | "pending_received">();

    for (const friendship of matchedUsers) {
      const otherUserId =
        friendship.userId === userId ? friendship.friendUserId : friendship.userId;

      if (friendship.status === "accepted") {
        friendStatusByUserId.set(otherUserId, "accepted");
      } else if (friendship.userId === userId) {
        friendStatusByUserId.set(otherUserId, "pending_sent");
      } else {
        friendStatusByUserId.set(otherUserId, "pending_received");
      }
    }

    const matchingPlaces = await db.query.places.findMany({
      where: or(
        accentInsensitiveLike(places.name, query),
        accentInsensitiveLike(places.slug, query),
        accentInsensitiveLike(places.city, query, {
          coalesceToEmpty: true,
        }),
        accentInsensitiveLike(places.state, query, {
          coalesceToEmpty: true,
        })
      ),
      orderBy: [asc(places.name)],
      limit,
    });
    const matchingEvents = await db.query.events.findMany({
      where: and(
        eq(events.visibility, "public"),
        eq(events.status, "active"),
        gte(events.startAt, new Date()),
        or(
          accentInsensitiveLike(events.title, query),
          accentInsensitiveLike(events.description, query, {
            coalesceToEmpty: true,
          }),
          accentInsensitiveLike(events.city, query, {
            coalesceToEmpty: true,
          }),
          accentInsensitiveLike(events.state, query, {
            coalesceToEmpty: true,
          })
        )
      ),
      orderBy: [asc(events.startAt)],
      limit,
      with: {
        venue: true,
        organizer: true,
        categoryLinks: {
          with: {
            category: true,
          },
        },
      },
    });

    const placeIds = matchingPlaces.map((place) => place.id);
    const now = new Date();

    const [followedPlaceIds, venueCounts, organizerCounts] = await Promise.all([
      userId && placeIds.length > 0
        ? db.query.placeFollows.findMany({
            where: and(
              eq(placeFollows.userId, userId),
              inArray(placeFollows.placeId, placeIds)
            ),
            columns: {
              placeId: true,
            },
          })
        : Promise.resolve([]),
      placeIds.length > 0
        ? db
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
            .groupBy(events.venueId)
        : Promise.resolve([]),
      placeIds.length > 0
        ? db
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
            .groupBy(events.organizerId)
        : Promise.resolve([]),
    ]);

    const followedPlaceIdSet = new Set(followedPlaceIds.map((follow) => follow.placeId));
    const placeCountMap = new Map<string, number>();

    for (const row of venueCounts) {
      if (row.placeId) {
        placeCountMap.set(row.placeId, (placeCountMap.get(row.placeId) ?? 0) + row.count);
      }
    }

    for (const row of organizerCounts) {
      if (row.placeId) {
        placeCountMap.set(row.placeId, (placeCountMap.get(row.placeId) ?? 0) + row.count);
      }
    }

    return NextResponse.json({
      events: matchingEvents.map((event) => {
        const mapped = mapEventCategoryData(event);

        return {
          id: mapped.id,
          title: mapped.title,
          description: mapped.description,
          coverImageUrl: mapped.coverImageUrl,
          eventUrl: mapped.eventUrl,
          startAt: mapped.startAt,
          endAt: mapped.endAt,
          address: mapped.address,
          city: mapped.city,
          state: mapped.state,
          timeZone: mapped.timeZone,
          metroAreaCity: null,
          metroAreaState: null,
          venueId: mapped.venueId,
          venueName: mapped.venue?.name ?? null,
          venueSlug: mapped.venue?.slug ?? null,
          organizerId: mapped.organizerId,
          organizerName: mapped.organizer?.name ?? null,
          organizerSlug: mapped.organizer?.slug ?? null,
          venueLogoImageUrl: mapped.venue?.logoImageUrl ?? null,
          organizerLogoImageUrl: mapped.organizer?.logoImageUrl ?? null,
          categories: mapped.categories,
          categoryLabels: mapped.categoryLabels,
          updatedAt: mapped.updatedAt,
          canEdit: false,
          isFollowed:
            (mapped.venueId ? followedPlaceIdSet.has(mapped.venueId) : false) ||
            (mapped.organizerId ? followedPlaceIdSet.has(mapped.organizerId) : false),
          isCreatedByCurrentUser: false,
          userRsvpStatus: null,
          userRsvpNotGoingReason: null,
          friendsGoing: [],
          friendsInterested: [],
        };
      }),
      users: matchingUsers.map((user) => ({
        id: user.id,
        name:
          [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
          user.username ||
          "Someone",
        username: user.username,
        avatarImageUrl: user.avatarImageUrl,
        friendStatus: friendStatusByUserId.get(user.id) ?? "none",
      })),
      places: matchingPlaces.map((place) => ({
        id: place.id,
        type: place.type,
        slug: place.slug,
        name: place.name,
        logoImageUrl: place.logoImageUrl,
        city: place.city,
        state: place.state,
        upcomingEventCount: placeCountMap.get(place.id) ?? 0,
        updatedAt: place.updatedAt,
        isFollowed: followedPlaceIdSet.has(place.id),
      })),
    });
  } catch (error) {
    console.error("Mobile search error:", error);
    return NextResponse.json({ error: "Failed to search" }, { status: 500 });
  }
}
