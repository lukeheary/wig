import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import {
  eventRsvps,
  events,
  placeFollows,
  places,
  userFriends,
  users,
} from "@/server/db/schema";
import {
  canEditMobileEvent,
  resolveMobileEventEditPermissions,
} from "@/app/api/mobile/event-edit-permissions";
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

    const userBaseConditions = [
      eq(users.isOnboarding, false),
      ...(userId ? [ne(users.id, userId)] : []),
    ];

    const matchingUsers = query
      ? await db.query.users.findMany({
          where: and(
            ...userBaseConditions,
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
    const recentUsers = !query
      ? await db.query.users.findMany({
          where: and(...userBaseConditions),
          columns: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatarImageUrl: true,
          },
          orderBy: [sql`${users.createdAt} desc`],
          limit: 20,
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

    const matchingPlaces = query
      ? await db.query.places.findMany({
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
        })
      : [];
    const suggestedPlaceEvents = !query
      ? await db.query.events.findMany({
          where: and(
            eq(events.visibility, "public"),
            eq(events.status, "active"),
            gte(events.startAt, new Date()),
            or(sql`${events.venueId} is not null`, sql`${events.organizerId} is not null`)
          ),
          orderBy: [asc(events.startAt)],
          limit: 50,
          columns: {
            venueId: true,
            organizerId: true,
          },
        })
      : [];
    const matchingEvents = query
      ? await db.query.events.findMany({
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
        })
      : [];
    const upcomingEvents = !query
      ? await db.query.events.findMany({
          where: and(
            eq(events.visibility, "public"),
            eq(events.status, "active"),
            gte(events.startAt, new Date())
          ),
          orderBy: [asc(events.startAt)],
          limit: 10,
          with: {
            venue: true,
            organizer: true,
            categoryLinks: {
              with: {
                category: true,
              },
            },
          },
        })
      : [];
    const suggestedPlaceIds = !query
      ? [
          ...new Set(
            suggestedPlaceEvents.flatMap((event) =>
              [event.venueId, event.organizerId].filter(
                (value): value is string => Boolean(value)
              )
            )
          ),
        ].slice(0, 10)
      : [];
    const suggestedPlaces = suggestedPlaceIds.length > 0
      ? await db.query.places.findMany({
          where: inArray(places.id, suggestedPlaceIds),
        })
      : [];
    const eventsToMap = query ? matchingEvents : upcomingEvents;
    const eventIds = eventsToMap.map((event) => event.id);

    const placeIds = [
      ...new Set([
        ...matchingPlaces.map((place) => place.id),
        ...suggestedPlaces.map((place) => place.id),
      ]),
    ];
    const now = new Date();

    const [followedPlaceIds, venueCounts, organizerCounts, editPermissions] = await Promise.all([
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
      resolveMobileEventEditPermissions(userId),
    ]);

    const followedPlaceIdSet = new Set(followedPlaceIds.map((follow) => follow.placeId));
    const placeCountMap = new Map<string, number>();
    const currentUserRsvpMap = new Map<
      string,
      {
        status: string;
        notGoingReason: string | null;
      }
    >();
    const socialRsvpsMap = new Map<
      string,
      Array<{
        status: "going" | "interested";
        user: {
          id: string;
          firstName: string | null;
          lastName: string | null;
          avatarImageUrl: string | null;
          isCurrentUser: boolean;
          isFriend: boolean;
        };
      }>
    >();

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

    if (userId && eventIds.length > 0) {
      const friendConnections = await db.query.userFriends.findMany({
        where: and(
          or(eq(userFriends.userId, userId), eq(userFriends.friendUserId, userId)),
          eq(userFriends.status, "accepted")
        ),
      });
      const friendIds = friendConnections.map((friendship) =>
        friendship.userId === userId ? friendship.friendUserId : friendship.userId
      );
      const friendIdSet = new Set(friendIds);

      const [currentUserRsvps, mirroredPartnerRsvps, friendRsvps] = await Promise.all([
        db.query.eventRsvps.findMany({
          where: and(
            inArray(eventRsvps.eventId, eventIds),
            eq(eventRsvps.userId, userId)
          ),
          with: {
            user: true,
          },
        }),
        db.query.eventRsvps.findMany({
          where: and(
            inArray(eventRsvps.eventId, eventIds),
            eq(eventRsvps.partnerRsvpByUserId, userId),
            inArray(eventRsvps.status, ["going", "interested"])
          ),
          with: {
            user: true,
          },
        }),
        friendIds.length > 0
          ? db.query.eventRsvps.findMany({
              where: and(
                inArray(eventRsvps.eventId, eventIds),
                inArray(eventRsvps.userId, friendIds),
                inArray(eventRsvps.status, ["going", "interested"])
              ),
              with: {
                user: true,
              },
            })
          : Promise.resolve([]),
      ]);

      for (const rsvp of currentUserRsvps) {
        currentUserRsvpMap.set(rsvp.eventId, {
          status: rsvp.status,
          notGoingReason: rsvp.notGoingReason,
        });
      }

      for (const rsvp of [...currentUserRsvps, ...mirroredPartnerRsvps, ...friendRsvps]) {
        if (!rsvp.user || (rsvp.status !== "going" && rsvp.status !== "interested")) {
          continue;
        }

        const attendees = socialRsvpsMap.get(rsvp.eventId) ?? [];
        const existingIndex = attendees.findIndex(
          (attendee) => attendee.user.id === rsvp.userId
        );
        const nextAttendee = {
          status: rsvp.status,
          user: {
            id: rsvp.user.id,
            firstName: rsvp.user.firstName,
            lastName: rsvp.user.lastName,
            avatarImageUrl: rsvp.user.avatarImageUrl,
            isCurrentUser: rsvp.userId === userId,
            isFriend: friendIdSet.has(rsvp.userId),
          },
        } as const;

        if (existingIndex >= 0) {
          if (
            attendees[existingIndex]?.status === "interested" &&
            nextAttendee.status === "going"
          ) {
            attendees[existingIndex] = nextAttendee;
          }
        } else {
          attendees.push(nextAttendee);
        }

        socialRsvpsMap.set(rsvp.eventId, attendees);
      }
    }

    return NextResponse.json({
      events: matchingEvents.map((event) => {
        const mapped = mapEventCategoryData(event);
        const currentUserRsvp = currentUserRsvpMap.get(mapped.id) ?? null;
        const socialRsvps = socialRsvpsMap.get(mapped.id) ?? [];

        return {
          id: mapped.id,
          title: mapped.title,
          description: mapped.description,
          coverImageUrl: mapped.coverImageUrl,
          eventUrl: mapped.eventUrl,
          seriesId: mapped.seriesId,
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
          status: mapped.status,
          canEdit:
            (Boolean(userId) && mapped.createdByUserId === userId) ||
            canEditMobileEvent(editPermissions, {
              venueId: mapped.venueId,
              organizerId: mapped.organizerId,
            }),
          isFollowed:
            (mapped.venueId ? followedPlaceIdSet.has(mapped.venueId) : false) ||
            (mapped.organizerId ? followedPlaceIdSet.has(mapped.organizerId) : false),
          isCreatedByCurrentUser: Boolean(userId) && mapped.createdByUserId === userId,
          userRsvpStatus: currentUserRsvp?.status ?? null,
          userRsvpNotGoingReason: currentUserRsvp?.notGoingReason ?? null,
          friendsGoing: socialRsvps.filter((rsvp) => rsvp.status === "going"),
          friendsInterested: socialRsvps.filter((rsvp) => rsvp.status === "interested"),
        };
      }),
      upcomingEvents: upcomingEvents.map((event) => {
        const mapped = mapEventCategoryData(event);
        const currentUserRsvp = currentUserRsvpMap.get(mapped.id) ?? null;
        const socialRsvps = socialRsvpsMap.get(mapped.id) ?? [];

        return {
          id: mapped.id,
          title: mapped.title,
          description: mapped.description,
          coverImageUrl: mapped.coverImageUrl,
          eventUrl: mapped.eventUrl,
          seriesId: mapped.seriesId,
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
          status: mapped.status,
          canEdit:
            (Boolean(userId) && mapped.createdByUserId === userId) ||
            canEditMobileEvent(editPermissions, {
              venueId: mapped.venueId,
              organizerId: mapped.organizerId,
            }),
          isFollowed:
            (mapped.venueId ? followedPlaceIdSet.has(mapped.venueId) : false) ||
            (mapped.organizerId ? followedPlaceIdSet.has(mapped.organizerId) : false),
          isCreatedByCurrentUser: Boolean(userId) && mapped.createdByUserId === userId,
          userRsvpStatus: currentUserRsvp?.status ?? null,
          userRsvpNotGoingReason: currentUserRsvp?.notGoingReason ?? null,
          friendsGoing: socialRsvps.filter((rsvp) => rsvp.status === "going"),
          friendsInterested: socialRsvps.filter((rsvp) => rsvp.status === "interested"),
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
      recentUsers: recentUsers
        .filter((user) => friendStatusByUserId.get(user.id) !== "accepted")
        .map((user) => ({
          id: user.id,
          name:
            [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
            user.username ||
            "Someone",
          username: user.username,
          avatarImageUrl: user.avatarImageUrl,
          friendStatus: friendStatusByUserId.get(user.id) ?? "none",
        })),
      suggestedPlaces: suggestedPlaceIds
        .map((placeId) => suggestedPlaces.find((place) => place.id === placeId))
        .filter((place): place is NonNullable<typeof place> => Boolean(place))
        .map((place) => ({
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
