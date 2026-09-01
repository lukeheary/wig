import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  or,
} from "drizzle-orm";
import { db } from "@/server/db";
import {
  cities,
  events,
  eventReviews,
  eventRsvps,
  metroAreas,
  placeFollows,
  placeMembers,
  userPromotedEvents,
  userFriends,
  userFriendsMutedNotifications,
  users,
} from "@/server/db/schema";
import { createMobileMetroResolver } from "@/app/api/mobile/metro";
import {
  canEditMobileEvent,
  resolveMobileEventEditPermissions,
} from "@/app/api/mobile/event-edit-permissions";
import { eventTimeZone } from "@/lib/utils";
import {
  mapEventCategoryData,
  mapPlaceCategoryData,
} from "@/server/utils/categories";
import { usersAreBlocked } from "@/server/utils/user-blocks";

const DEFAULT_MOBILE_FEED_TIME_ZONE = "America/New_York";
const timeZoneFormatterCache = new Map<string, Intl.DateTimeFormat>();

interface TimeZoneDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function userSummary(user: typeof users.$inferSelect | null | undefined) {
  if (!user) return null;

  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    "Someone";

  return {
    id: user.id,
    name,
    username: user.username,
    avatarImageUrl: user.avatarImageUrl,
    city: user.city,
    state: user.state,
  };
}

function getTimeZoneDateTimeParts(
  date: Date,
  timeZone: string
): TimeZoneDateTimeParts | null {
  try {
    let formatter = timeZoneFormatterCache.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      timeZoneFormatterCache.set(timeZone, formatter);
    }

    const values = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );

    const year = Number(values.year);
    const month = Number(values.month);
    const day = Number(values.day);
    const hour = Number(values.hour);
    const minute = Number(values.minute);
    const second = Number(values.second);

    if (
      Number.isNaN(year) ||
      Number.isNaN(month) ||
      Number.isNaN(day) ||
      Number.isNaN(hour) ||
      Number.isNaN(minute) ||
      Number.isNaN(second)
    ) {
      return null;
    }

    return { year, month, day, hour, minute, second };
  } catch {
    return null;
  }
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTimeZoneDateTimeParts(date, timeZone);
  if (!parts) return null;

  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return asUtc - date.getTime();
}

function startOfDayInTimeZone(date: Date, timeZone: string) {
  const parts = getTimeZoneDateTimeParts(date, timeZone);
  if (!parts) {
    const fallback = new Date(date);
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }

  const naiveUtcMidnight = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day)
  );
  const offset = getTimeZoneOffsetMs(naiveUtcMidnight, timeZone) ?? 0;

  return new Date(naiveUtcMidnight.getTime() - offset);
}

function currentWeekBoundsInTimeZone(date: Date, timeZone: string) {
  const parts = getTimeZoneDateTimeParts(date, timeZone);
  if (!parts) {
    const weekStart = new Date(date);
    const daysSinceMonday = (weekStart.getDay() + 6) % 7;
    weekStart.setDate(weekStart.getDate() - daysSinceMonday);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return { weekStart, weekEnd };
  }

  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
  const mondayNoonUtc = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day - daysSinceMonday, 12)
  );
  const nextMondayNoonUtc = new Date(mondayNoonUtc);
  nextMondayNoonUtc.setUTCDate(nextMondayNoonUtc.getUTCDate() + 7);

  return {
    weekStart: startOfDayInTimeZone(mondayNoonUtc, timeZone),
    weekEnd: startOfDayInTimeZone(nextMondayNoonUtc, timeZone),
  };
}

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

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const { userId: authenticatedViewerId } = await auth();

  if (
    authenticatedViewerId &&
    authenticatedViewerId !== id &&
    (await usersAreBlocked(authenticatedViewerId, id))
  ) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const viewerUserId = await currentMobileUserId();
  const now = new Date();

  const [targetUser, availableMetroAreas, cityCoordinates] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, id),
    }),
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
  ]);

  if (!targetUser) {
    return NextResponse.json(
      {
        profile: null,
        friendCount: 0,
        followingCount: 0,
        followedPlaces: [],
        memberPlaceCount: 0,
        memberPlaces: [],
        friends: [],
        promotingEvents: [],
        upcomingEvents: [],
        pastEvents: [],
      },
      { status: 404 }
    );
  }

  const resolveMetroArea = createMobileMetroResolver(
    availableMetroAreas,
    cityCoordinates
  );
  const targetMetroArea =
    targetUser.city && targetUser.state
      ? resolveMetroArea({ city: targetUser.city, state: targetUser.state })
      : null;
  const feedTimeZone =
    eventTimeZone(undefined, targetMetroArea?.state) ??
    DEFAULT_MOBILE_FEED_TIME_ZONE;
  const today = startOfDayInTimeZone(now, feedTimeZone);

  const friendships = await db.query.userFriends.findMany({
    where: and(
      or(eq(userFriends.userId, id), eq(userFriends.friendUserId, id)),
      eq(userFriends.status, "accepted")
    ),
    orderBy: [asc(userFriends.createdAt)],
    with: {
      user: true,
      friend: true,
    },
  });

  const friends = friendships
    .map((friendship) =>
      friendship.userId === id
        ? userSummary(friendship.friend)
        : userSummary(friendship.user)
    )
    .filter((friend): friend is NonNullable<typeof friend> => Boolean(friend));

  const [
    upcomingRsvps,
    pastRsvps,
    targetFollowedPlaces,
    targetPlaceMemberships,
    followedPlaceIds,
    editPermissions,
    viewerFriendships,
    viewerTargetFriendship,
    viewerNotificationMute,
  ] = await Promise.all([
    db.query.eventRsvps.findMany({
      where: and(
        eq(eventRsvps.userId, id),
        inArray(eventRsvps.status, ["going", "interested"])
      ),
      with: {
        event: {
          with: {
            venue: true,
            organizer: true,
            categoryLinks: {
              with: {
                category: true,
              },
            },
          },
        },
      },
      orderBy: [asc(eventRsvps.updatedAt)],
    }),
    db.query.eventRsvps.findMany({
      where: and(
        eq(eventRsvps.userId, id),
        inArray(eventRsvps.status, ["going", "interested"])
      ),
      with: {
        event: {
          with: {
            venue: true,
            organizer: true,
            categoryLinks: {
              with: {
                category: true,
              },
            },
          },
        },
      },
      orderBy: [desc(eventRsvps.updatedAt)],
    }),
    db.query.placeFollows.findMany({
      where: eq(placeFollows.userId, id),
      with: {
        place: {
          with: {
            categoryLinks: {
              with: {
                category: true,
              },
            },
          },
        },
      },
      orderBy: [desc(placeFollows.createdAt)],
    }),
    db.query.placeMembers.findMany({
      where: eq(placeMembers.userId, id),
      with: {
        place: {
          with: {
            categoryLinks: {
              with: {
                category: true,
              },
            },
          },
        },
      },
      orderBy: [asc(placeMembers.createdAt)],
    }),
    viewerUserId
      ? db.query.placeFollows.findMany({
          where: eq(placeFollows.userId, viewerUserId),
          columns: {
            placeId: true,
          },
        })
      : Promise.resolve([]),
    resolveMobileEventEditPermissions(viewerUserId),
    viewerUserId
      ? db.query.userFriends.findMany({
          where: and(
            or(
              eq(userFriends.userId, viewerUserId),
              eq(userFriends.friendUserId, viewerUserId)
            ),
            eq(userFriends.status, "accepted")
          ),
        })
      : Promise.resolve([]),
    viewerUserId
      ? db.query.userFriends.findFirst({
          where: or(
            and(
              eq(userFriends.userId, viewerUserId),
              eq(userFriends.friendUserId, id)
            ),
            and(
              eq(userFriends.userId, id),
              eq(userFriends.friendUserId, viewerUserId)
            )
          ),
        })
      : Promise.resolve(null),
    viewerUserId && viewerUserId !== id
      ? db.query.userFriendsMutedNotifications.findFirst({
          where: and(
            eq(userFriendsMutedNotifications.userId, viewerUserId),
            eq(userFriendsMutedNotifications.friendUserId, id)
          ),
          columns: {
            userId: true,
          },
        })
      : Promise.resolve(null),
  ]);

  const upcomingEventsRaw = upcomingRsvps
    .map((rsvp) => rsvp.event)
    .filter((event): event is NonNullable<typeof event> => Boolean(event))
    .filter((event) => event.startAt >= today);
  const pastEventsRaw = pastRsvps
    .map((rsvp) => rsvp.event)
    .filter((event): event is NonNullable<typeof event> => Boolean(event))
    .filter((event) => event.startAt < today);

  const promoterPlaceIds = targetPlaceMemberships
    .filter((membership) => membership.role === "promoter")
    .map((membership) => membership.placeId);
  const { weekEnd } = currentWeekBoundsInTimeZone(now, feedTimeZone);
  const promotingEventsRaw =
    promoterPlaceIds.length > 0
      ? await db.query.userPromotedEvents
          .findMany({
            where: eq(userPromotedEvents.userId, id),
            with: {
              event: {
                with: {
                  venue: true,
                  organizer: true,
                  categoryLinks: { with: { category: true } },
                },
              },
            },
          })
          .then((selections) =>
            selections
              .filter(
                ({ event }) =>
                  event.startAt >= now &&
                  event.startAt < weekEnd &&
                  event.visibility === "public" &&
                  event.status === "active" &&
                  ((event.venueId !== null &&
                    promoterPlaceIds.includes(event.venueId)) ||
                    (event.organizerId !== null &&
                      promoterPlaceIds.includes(event.organizerId)))
              )
              .sort(
                (a, b) => a.event.startAt.getTime() - b.event.startAt.getTime()
              )
          )
      : [];

  const followedPlaceIdSet = new Set(
    followedPlaceIds.map((follow) => follow.placeId)
  );
  const viewerFriendIds = new Set(
    viewerFriendships.map((friendship) =>
      friendship.userId === viewerUserId
        ? friendship.friendUserId
        : friendship.userId
    )
  );

  const allEventIds = [
    ...new Set([
      ...upcomingEventsRaw.map((event) => event.id),
      ...pastEventsRaw.map((event) => event.id),
      ...promotingEventsRaw.map(({ event }) => event.id),
    ]),
  ];

  const viewerReviews =
    viewerUserId && allEventIds.length > 0
      ? await db.query.eventReviews.findMany({
          where: and(
            inArray(eventReviews.eventId, allEventIds),
            eq(eventReviews.userId, viewerUserId),
            isNotNull(eventReviews.rating)
          ),
        })
      : [];
  const viewerReviewMap = new Map(
    viewerReviews.map((review) => [review.eventId, review])
  );

  const [viewerRsvps, mirroredPartnerRsvps, friendRsvps] =
    viewerUserId && allEventIds.length > 0
      ? await Promise.all([
          db.query.eventRsvps.findMany({
            where: and(
              inArray(eventRsvps.eventId, allEventIds),
              eq(eventRsvps.userId, viewerUserId)
            ),
            with: {
              user: true,
            },
          }),
          db.query.eventRsvps.findMany({
            where: and(
              inArray(eventRsvps.eventId, allEventIds),
              eq(eventRsvps.partnerRsvpByUserId, viewerUserId),
              inArray(eventRsvps.status, ["going", "interested"])
            ),
            with: {
              user: true,
            },
          }),
          viewerFriendIds.size > 0
            ? db.query.eventRsvps.findMany({
                where: and(
                  inArray(eventRsvps.eventId, allEventIds),
                  inArray(eventRsvps.userId, [...viewerFriendIds]),
                  inArray(eventRsvps.status, ["going", "interested"])
                ),
                with: {
                  user: true,
                },
              })
            : Promise.resolve([]),
        ])
      : [[], [], []];

  const viewerRsvpMap = new Map<
    string,
    {
      status: "going" | "interested" | "not_going";
      notGoingReason: string | null;
    }
  >();
  for (const rsvp of viewerRsvps) {
    viewerRsvpMap.set(rsvp.eventId, {
      status: rsvp.status,
      notGoingReason: rsvp.notGoingReason,
    });
  }

  const socialRsvpsMap = new Map<string, Array<any>>();
  const addSocialRsvp = (rsvp: any) => {
    if (!socialRsvpsMap.has(rsvp.eventId)) {
      socialRsvpsMap.set(rsvp.eventId, []);
    }

    const attendees = socialRsvpsMap.get(rsvp.eventId)!;
    const existingIndex = attendees.findIndex(
      (attendee: any) => attendee.userId === rsvp.userId
    );

    if (existingIndex >= 0) {
      if (
        attendees[existingIndex].status === "interested" &&
        rsvp.status === "going"
      ) {
        attendees[existingIndex] = rsvp;
      }
      return;
    }

    attendees.push(rsvp);
  };

  for (const rsvp of [
    ...viewerRsvps,
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

    addSocialRsvp({
      eventId: rsvp.eventId,
      userId: rsvp.userId,
      status: rsvp.status,
      user: {
        id: rsvp.user.id,
        firstName: rsvp.user.firstName,
        lastName: rsvp.user.lastName,
        avatarImageUrl: rsvp.user.avatarImageUrl,
        isCurrentUser: rsvp.userId === viewerUserId,
        isFriend: viewerFriendIds.has(rsvp.userId),
      },
      isCurrentUser: rsvp.userId === viewerUserId,
      isFriend: viewerFriendIds.has(rsvp.userId),
    });
  }

  const mapMobileEvent = (event: (typeof upcomingEventsRaw)[number]) => {
    const mapped = mapEventCategoryData(event);
    const socialRsvps = socialRsvpsMap.get(mapped.id) ?? [];
    const viewerRsvp = viewerRsvpMap.get(mapped.id) ?? null;
    const metroArea = resolveMetroArea({
      city: mapped.city,
      state: mapped.state,
    });

    return {
      id: mapped.id,
      publicId: mapped.publicId,
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
      metroAreaCity: metroArea?.city ?? null,
      metroAreaState: metroArea?.state ?? null,
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
      canEdit: canEditMobileEvent(editPermissions, {
        createdByUserId: mapped.createdByUserId,
      }),
      isFollowed:
        (mapped.venueId ? followedPlaceIdSet.has(mapped.venueId) : false) ||
        (mapped.organizerId
          ? followedPlaceIdSet.has(mapped.organizerId)
          : false),
      isCreatedByCurrentUser:
        Boolean(viewerUserId) && mapped.createdByUserId === viewerUserId,
      userRsvpStatus: viewerRsvp?.status ?? null,
      userRsvpNotGoingReason: viewerRsvp?.notGoingReason ?? null,
      currentUserReview: viewerReviewMap.get(mapped.id) ?? null,
      friendsGoing: socialRsvps.filter((rsvp: any) => rsvp.status === "going"),
      friendsInterested: socialRsvps.filter(
        (rsvp: any) => rsvp.status === "interested"
      ),
      friendsNotGoing: socialRsvps.filter(
        (rsvp: any) => rsvp.status === "not_going"
      ),
    };
  };

  return NextResponse.json({
    profile: targetUser
      ? {
          ...userSummary(targetUser),
          friendshipId: viewerTargetFriendship?.id ?? null,
          friendStatus: viewerTargetFriendship
            ? viewerTargetFriendship.status === "accepted"
              ? "accepted"
              : viewerTargetFriendship.userId === viewerUserId
                ? "pending_sent"
                : "pending_received"
            : "none",
          notificationsMuted: Boolean(viewerNotificationMute),
        }
      : null,
    friendCount: friends.length,
    followingCount: targetFollowedPlaces.length,
    followedPlaces: targetFollowedPlaces.map(({ place }) => {
      const mappedPlace = mapPlaceCategoryData(place);
      const metroArea = resolveMetroArea({
        city: place.city,
        state: place.state,
      });

      return {
        id: mappedPlace.id,
        type: mappedPlace.type,
        slug: mappedPlace.slug,
        name: mappedPlace.name,
        logoImageUrl: mappedPlace.logoImageUrl,
        address: mappedPlace.address,
        city: mappedPlace.city,
        state: mappedPlace.state,
        website: mappedPlace.website,
        instagram: mappedPlace.instagram,
        metroAreaCity: metroArea?.city ?? null,
        metroAreaState: metroArea?.state ?? null,
        upcomingEventCount: 0,
        updatedAt: mappedPlace.updatedAt,
        isFollowed: followedPlaceIdSet.has(mappedPlace.id),
        categories: mappedPlace.categories,
        categoryLabels: mappedPlace.categoryLabels,
      };
    }),
    memberPlaceCount: targetPlaceMemberships.length,
    memberPlaces: targetPlaceMemberships.map(({ place, role }) => {
      const mappedPlace = mapPlaceCategoryData(place);
      const metroArea = resolveMetroArea({
        city: place.city,
        state: place.state,
      });

      return {
        place: {
          id: mappedPlace.id,
          type: mappedPlace.type,
          slug: mappedPlace.slug,
          name: mappedPlace.name,
          logoImageUrl: mappedPlace.logoImageUrl,
          address: mappedPlace.address,
          city: mappedPlace.city,
          state: mappedPlace.state,
          website: mappedPlace.website,
          instagram: mappedPlace.instagram,
          metroAreaCity: metroArea?.city ?? null,
          metroAreaState: metroArea?.state ?? null,
          upcomingEventCount: 0,
          updatedAt: mappedPlace.updatedAt,
          isFollowed: followedPlaceIdSet.has(mappedPlace.id),
          isMember: true,
          categories: mappedPlace.categories,
          categoryLabels: mappedPlace.categoryLabels,
        },
        role,
      };
    }),
    friends,
    promotingEvents: promotingEventsRaw.map(({ event, promo, promoUrl }) => ({
      ...mapMobileEvent(event),
      promo,
      promoUrl,
    })),
    upcomingEvents: upcomingEventsRaw.map(mapMobileEvent),
    pastEvents: pastEventsRaw.map(mapMobileEvent),
  });
}
