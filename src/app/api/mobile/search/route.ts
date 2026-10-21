import { withVisibleProfiles } from "@/server/utils/profile-visibility";
import { visibleEventSourceCondition } from "@/server/utils/event-source-visibility";
import { auth } from "@clerk/nextjs/server";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import {
  eventRsvps,
  events,
  cities,
  metroAreas,
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
import { goingRsvpCountsForEventIds } from "@/app/api/mobile/event-rsvp-counts";
import { accentInsensitiveLike } from "@/server/db/search";
import { createMobileMetroResolver } from "@/app/api/mobile/metro";
import { blockedUserIdsFor } from "@/server/utils/user-blocks";

function searchQueryVariants(query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const normalizedWhitespace = trimmed.replace(/\s+/g, " ");
  const ampersandVariant = normalizedWhitespace.replace(/\s*&\s*/g, " & ");
  const andVariant = normalizedWhitespace.replace(/\s*&\s*/g, " and ");
  // Match the connector whether it is between words or the last complete token
  // being typed. This keeps "Above and" matched to "Above & Beyond".
  const swappedAmpersandVariant = normalizedWhitespace.replace(
    /\s+and\b/gi,
    " &"
  );
  const swappedAndVariant = normalizedWhitespace.replace(/\s+and\b/gi, " and");
  // Treat a trailing partial "and" connector as an ampersand as the user types.
  // This lets queries such as "Above a" find "Above & Beyond".
  const partialConnectorVariants = /\s+(?:a|an)$/i.test(normalizedWhitespace)
    ? [
        normalizedWhitespace.replace(/\s+(?:a|an)$/i, " &"),
        normalizedWhitespace.replace(/\s+(?:a|an)$/i, " and"),
      ]
    : [];

  return [
    ...new Set(
      [
        normalizedWhitespace,
        ampersandVariant,
        andVariant,
        swappedAmpersandVariant,
        swappedAndVariant,
        ...partialConnectorVariants,
      ]
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    ),
  ];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query")?.trim() ?? "";
    const queryVariants = searchQueryVariants(query);
    const userQueryVariants = [
      ...new Set(
        queryVariants.flatMap((variant) => [
          variant,
          variant.replace(/^@+/, ""),
        ])
      ),
    ].filter(Boolean);
    const includeCurrentUser =
      searchParams.get("includeCurrentUser") === "true";
    const limitParam = Number(searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 30)
      : 12;

    const { userId } = await auth();
    const blockedUserIds = userId ? [...(await blockedUserIdsFor(userId))] : [];
    const [searchUser, availableMetroAreas, cityCoordinates] =
      await Promise.all([
        userId
          ? db.query.users.findFirst({
              where: eq(users.id, userId),
              columns: { city: true, state: true },
            })
          : db.query.users.findFirst({
              where: eq(users.isOnboarding, false),
              orderBy: [asc(users.createdAt)],
              columns: { city: true, state: true },
            }),
        db
          .select({
            name: metroAreas.name,
            state: metroAreas.state,
            latitude: metroAreas.latitude,
            longitude: metroAreas.longitude,
            radiusMiles: metroAreas.radiusMiles,
          })
          .from(metroAreas),
        db
          .select({
            name: cities.name,
            state: cities.state,
            latitude: cities.latitude,
            longitude: cities.longitude,
          })
          .from(cities),
      ]);
    const resolveMetroArea = createMobileMetroResolver(
      availableMetroAreas,
      cityCoordinates
    );
    const currentMetroArea =
      searchUser?.city && searchUser?.state
        ? resolveMetroArea({ city: searchUser.city, state: searchUser.state })
        : null;
    const isInCurrentMetroArea = (location: {
      city: string | null;
      state: string | null;
    }) => {
      if (!currentMetroArea) return false;
      const metroArea = resolveMetroArea(location);
      return (
        metroArea?.city === currentMetroArea.city &&
        metroArea?.state === currentMetroArea.state
      );
    };
    const matchedUsers = userId
      ? await db.query.userFriends.findMany({
          where: await withVisibleProfiles(or(
            eq(userFriends.userId, userId),
            eq(userFriends.friendUserId, userId)
          ), userFriends.userId, userFriends.friendUserId),
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
      ...(userId && !includeCurrentUser ? [ne(users.id, userId)] : []),
      ...(blockedUserIds.length > 0
        ? [notInArray(users.id, blockedUserIds)]
        : []),
    ];

    const matchingUsers = query
      ? await db.query.users.findMany({
          where: await withVisibleProfiles(and(
            ...userBaseConditions,
            or(
              ...userQueryVariants.flatMap((variant) => [
                accentInsensitiveLike(users.username, variant),
                accentInsensitiveLike(users.firstName, variant, {
                  coalesceToEmpty: true,
                }),
                accentInsensitiveLike(users.lastName, variant, {
                  coalesceToEmpty: true,
                }),
              ])
            )
          ), users.id),
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
      ? await (async () => {
          const directConnectionIds = new Set(
            matchedUsers.map((friendship) =>
              friendship.userId === userId
                ? friendship.friendUserId
                : friendship.userId
            )
          );
          const acceptedFriendIds = matchedUsers
            .filter((friendship) => friendship.status === "accepted")
            .map((friendship) =>
              friendship.userId === userId
                ? friendship.friendUserId
                : friendship.userId
            );

          if (userId && acceptedFriendIds.length > 0) {
            const secondDegreeConnections = await db.query.userFriends.findMany(
              {
                where: and(
                  eq(userFriends.status, "accepted"),
                  or(
                    inArray(userFriends.userId, acceptedFriendIds),
                    inArray(userFriends.friendUserId, acceptedFriendIds)
                  )
                ),
                columns: {
                  userId: true,
                  friendUserId: true,
                },
              }
            );
            const friendOfFriendIds = [
              ...new Set(
                secondDegreeConnections
                  .flatMap((friendship) => [
                    friendship.userId,
                    friendship.friendUserId,
                  ])
                  .filter((id) => id !== userId && !directConnectionIds.has(id))
              ),
            ];

            if (friendOfFriendIds.length > 0) {
              return db.query.users.findMany({
                where: await withVisibleProfiles(and(
                  ...userBaseConditions,
                  inArray(users.id, friendOfFriendIds)
                ), users.id),
                columns: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                  avatarImageUrl: true,
                },
                orderBy: [
                  asc(users.firstName),
                  asc(users.lastName),
                  asc(users.username),
                ],
                limit: 20,
              });
            }
          }

          return db.query.users.findMany({
            where: await withVisibleProfiles(and(
              ...userBaseConditions,
              ...(directConnectionIds.size > 0
                ? [notInArray(users.id, [...directConnectionIds])]
                : [])
            ), users.id),
            columns: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatarImageUrl: true,
            },
            orderBy: [
              asc(users.firstName),
              asc(users.lastName),
              asc(users.username),
            ],
            limit: 20,
          });
        })()
      : [];

    const friendStatusByUserId = new Map<
      string,
      "accepted" | "pending_sent" | "pending_received"
    >();

    for (const friendship of matchedUsers) {
      const otherUserId =
        friendship.userId === userId
          ? friendship.friendUserId
          : friendship.userId;

      if (friendship.status === "accepted") {
        friendStatusByUserId.set(otherUserId, "accepted");
      } else if (friendship.userId === userId) {
        friendStatusByUserId.set(otherUserId, "pending_sent");
      } else {
        friendStatusByUserId.set(otherUserId, "pending_received");
      }
    }

    const recentNonFriendUsers = recentUsers.filter(
      (user) => !friendStatusByUserId.has(user.id)
    );
    const pendingRequestUserIds = matchedUsers
      .filter((friendship) => friendship.status === "pending")
      .map((friendship) =>
        friendship.userId === userId
          ? friendship.friendUserId
          : friendship.userId
      );
    const acceptedFriendUserIds = matchedUsers
      .filter((friendship) => friendship.status === "accepted")
      .map((friendship) =>
        friendship.userId === userId
          ? friendship.friendUserId
          : friendship.userId
      );
    const remainingPendingUserSlots = Math.max(
      20 - recentNonFriendUsers.length,
      0
    );
    const recentPendingUsers =
      !query &&
      remainingPendingUserSlots > 0 &&
      pendingRequestUserIds.length > 0
        ? await db.query.users.findMany({
            where: await withVisibleProfiles(and(
              ...userBaseConditions,
              inArray(users.id, pendingRequestUserIds)
            ), users.id),
            columns: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatarImageUrl: true,
            },
            orderBy: [asc(users.firstName), asc(users.lastName)],
            limit: remainingPendingUserSlots,
          })
        : [];
    const remainingRecentUserSlots = Math.max(
      20 - recentNonFriendUsers.length - recentPendingUsers.length,
      0
    );
    const recentFriendUsers =
      !query && remainingRecentUserSlots > 0 && acceptedFriendUserIds.length > 0
        ? await db.query.users.findMany({
            where: await withVisibleProfiles(and(
              ...userBaseConditions,
              inArray(users.id, acceptedFriendUserIds)
            ), users.id),
            columns: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatarImageUrl: true,
            },
            orderBy: [asc(users.firstName), asc(users.lastName)],
            limit: remainingRecentUserSlots,
          })
        : [];

    const matchingPlaces = query && currentMetroArea
      ? (
          await db.query.places.findMany({
            where: and(
              eq(places.isEnabled, true),
              or(
                ...queryVariants.flatMap((variant) => [
                  accentInsensitiveLike(places.name, variant),
                  accentInsensitiveLike(places.slug, variant),
                  accentInsensitiveLike(places.city, variant, {
                    coalesceToEmpty: true,
                  }),
                  accentInsensitiveLike(places.state, variant, {
                    coalesceToEmpty: true,
                  }),
                ])
              )
            ),
            orderBy: [asc(places.name)],
            limit: 200,
          })
        )
          .filter(isInCurrentMetroArea)
          .slice(0, limit)
      : [];
    const metroPlaces =
      !query && currentMetroArea
        ? await db.query.places.findMany({
            where: eq(places.isEnabled, true),
            orderBy: [asc(places.name)],
            limit: 200,
          })
        : [];
    const matchingEventCandidates =
      query && currentMetroArea
        ? await db.query.events.findMany({
          where: and(
            eq(events.visibility, "public"),
            visibleEventSourceCondition(),
            eq(events.status, "active"),
            gte(events.startAt, new Date()),
            eq(events.state, currentMetroArea.state),
            or(
              ...queryVariants.flatMap((variant) => [
                accentInsensitiveLike(events.title, variant),
                accentInsensitiveLike(events.city, variant, {
                  coalesceToEmpty: true,
                }),
                accentInsensitiveLike(events.state, variant, {
                  coalesceToEmpty: true,
                }),
              ])
            )
          ),
          orderBy: [asc(events.startAt)],
          limit: 200,
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
    const matchingEvents = matchingEventCandidates
      .filter(isInCurrentMetroArea)
      .slice(0, limit);
    const upcomingEventCandidates =
      !query && currentMetroArea
        ? await db.query.events.findMany({
          where: and(
            eq(events.visibility, "public"),
            visibleEventSourceCondition(),
            eq(events.status, "active"),
            gte(events.startAt, new Date()),
            eq(events.state, currentMetroArea.state)
          ),
          orderBy: [sql`random()`],
          limit: 200,
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
    const upcomingEvents = upcomingEventCandidates
      .filter(isInCurrentMetroArea)
      .slice(0, 10);
    const suggestedPlaces = metroPlaces.filter(isInCurrentMetroArea);
    const eventsToMap = query ? matchingEvents : upcomingEvents;
    const eventIds = eventsToMap.map((event) => event.id);
    const goingRsvpCounts = await goingRsvpCountsForEventIds(eventIds);

    const placeIds = [
      ...new Set([
        ...matchingPlaces.map((place) => place.id),
        ...suggestedPlaces.map((place) => place.id),
      ]),
    ];
    const now = new Date();

    const [followedPlaceIds, venueCounts, organizerCounts, editPermissions] =
      await Promise.all([
        userId && placeIds.length > 0
          ? db.query.placeFollows.findMany({
              where: await withVisibleProfiles(and(
                eq(placeFollows.userId, userId),
                inArray(placeFollows.placeId, placeIds)
              ), placeFollows.userId),
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
                  visibleEventSourceCondition(),
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
                  visibleEventSourceCondition(),
                  eq(events.status, "active"),
                  gte(events.startAt, now)
                )
              )
              .groupBy(events.organizerId)
          : Promise.resolve([]),
        resolveMobileEventEditPermissions(userId),
      ]);

    const followedPlaceIdSet = new Set(
      followedPlaceIds.map((follow) => follow.placeId)
    );
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
        status: "going" | "interested" | "not_going";
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
        placeCountMap.set(
          row.placeId,
          (placeCountMap.get(row.placeId) ?? 0) + row.count
        );
      }
    }

    for (const row of organizerCounts) {
      if (row.placeId) {
        placeCountMap.set(
          row.placeId,
          (placeCountMap.get(row.placeId) ?? 0) + row.count
        );
      }
    }

    if (userId && eventIds.length > 0) {
      const friendConnections = await db.query.userFriends.findMany({
        where: await withVisibleProfiles(and(
          or(
            eq(userFriends.userId, userId),
            eq(userFriends.friendUserId, userId)
          ),
          eq(userFriends.status, "accepted")
        ), userFriends.userId, userFriends.friendUserId),
      });
      const friendIds = friendConnections.map((friendship) =>
        friendship.userId === userId
          ? friendship.friendUserId
          : friendship.userId
      );
      const friendIdSet = new Set(friendIds);

      const [currentUserRsvps, mirroredPartnerRsvps, friendRsvps] =
        await Promise.all([
          db.query.eventRsvps.findMany({
            where: await withVisibleProfiles(and(
              inArray(eventRsvps.eventId, eventIds),
              eq(eventRsvps.userId, userId)
            ), eventRsvps.userId),
            with: {
              user: true,
            },
          }),
          db.query.eventRsvps.findMany({
            where: await withVisibleProfiles(and(
              inArray(eventRsvps.eventId, eventIds),
              eq(eventRsvps.partnerRsvpByUserId, userId),
              inArray(eventRsvps.status, ["going", "interested", "not_going"])
            ), eventRsvps.userId),
            with: {
              user: true,
            },
          }),
          friendIds.length > 0
            ? db.query.eventRsvps.findMany({
                where: await withVisibleProfiles(and(
                  inArray(eventRsvps.eventId, eventIds),
                  inArray(eventRsvps.userId, friendIds),
                  inArray(eventRsvps.status, [
                    "going",
                    "interested",
                    "not_going",
                  ])
                ), eventRsvps.userId),
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

      for (const rsvp of [
        ...currentUserRsvps,
        ...mirroredPartnerRsvps,
        ...friendRsvps,
      ]) {
        if (
          !rsvp.user ||
          (rsvp.status !== "going" &&
            rsvp.status !== "interested" &&
            rsvp.status !== "not_going")
        ) {
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
          publicId: mapped.publicId,
          title: mapped.title,
          description: mapped.description,
          source: mapped.source,
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
          createdAt: mapped.createdAt,
          updatedAt: mapped.updatedAt,
          status: mapped.status,
          canEdit:
            canEditMobileEvent(editPermissions, {
              createdByUserId: mapped.createdByUserId,
            }),
          isFollowed:
            (mapped.venueId ? followedPlaceIdSet.has(mapped.venueId) : false) ||
            (mapped.organizerId
              ? followedPlaceIdSet.has(mapped.organizerId)
              : false),
          isCreatedByCurrentUser:
            Boolean(userId) && mapped.createdByUserId === userId,
          userRsvpStatus: currentUserRsvp?.status ?? null,
          userRsvpNotGoingReason: currentUserRsvp?.notGoingReason ?? null,
          goingCount: goingRsvpCounts.get(mapped.id) ?? 0,
          friendsGoing: socialRsvps.filter((rsvp) => rsvp.status === "going"),
          friendsInterested: socialRsvps.filter(
            (rsvp) => rsvp.status === "interested"
          ),
          friendsNotGoing: socialRsvps.filter(
            (rsvp) => rsvp.status === "not_going"
          ),
        };
      }),
      upcomingEvents: upcomingEvents.map((event) => {
        const mapped = mapEventCategoryData(event);
        const currentUserRsvp = currentUserRsvpMap.get(mapped.id) ?? null;
        const socialRsvps = socialRsvpsMap.get(mapped.id) ?? [];

        return {
          id: mapped.id,
          publicId: mapped.publicId,
          title: mapped.title,
          description: mapped.description,
          source: mapped.source,
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
          createdAt: mapped.createdAt,
          updatedAt: mapped.updatedAt,
          status: mapped.status,
          canEdit:
            canEditMobileEvent(editPermissions, {
              createdByUserId: mapped.createdByUserId,
            }),
          isFollowed:
            (mapped.venueId ? followedPlaceIdSet.has(mapped.venueId) : false) ||
            (mapped.organizerId
              ? followedPlaceIdSet.has(mapped.organizerId)
              : false),
          isCreatedByCurrentUser:
            Boolean(userId) && mapped.createdByUserId === userId,
          userRsvpStatus: currentUserRsvp?.status ?? null,
          userRsvpNotGoingReason: currentUserRsvp?.notGoingReason ?? null,
          goingCount: goingRsvpCounts.get(mapped.id) ?? 0,
          friendsGoing: socialRsvps.filter((rsvp) => rsvp.status === "going"),
          friendsInterested: socialRsvps.filter(
            (rsvp) => rsvp.status === "interested"
          ),
          friendsNotGoing: socialRsvps.filter(
            (rsvp) => rsvp.status === "not_going"
          ),
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
      recentUsers: [
        ...recentNonFriendUsers,
        ...recentPendingUsers,
        ...recentFriendUsers,
      ]
        .slice(0, 20)
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
      suggestedPlaces: suggestedPlaces.map((place) => {
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
          upcomingEventCount: placeCountMap.get(place.id) ?? 0,
          updatedAt: place.updatedAt,
          isFollowed: followedPlaceIdSet.has(place.id),
        };
      }),
      places: matchingPlaces.map((place) => {
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
          upcomingEventCount: placeCountMap.get(place.id) ?? 0,
          updatedAt: place.updatedAt,
          isFollowed: followedPlaceIdSet.has(place.id),
        };
      }),
    });
  } catch (error) {
    console.error("Mobile search error:", error);
    return NextResponse.json({ error: "Failed to search" }, { status: 500 });
  }
}
