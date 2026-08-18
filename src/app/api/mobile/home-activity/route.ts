import { auth } from "@clerk/nextjs/server";
import { addDays, subDays } from "date-fns";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import {
  cities,
  eventRsvps,
  metroAreas,
  placeFollows,
  userActivity,
  userFriends,
  userPartners,
  userSurfaceState,
  users,
} from "@/server/db/schema";
import { mapEventCategoryData } from "@/server/utils/categories";
import {
  canEditMobileEvent,
  resolveMobileEventEditPermissions,
} from "@/app/api/mobile/event-edit-permissions";
import {
  createMobileMetroResolver,
  mobileMetroAreas,
} from "@/app/api/mobile/metro";
import { eventTimeZone } from "@/lib/utils";

const HOME_RECENT_ACTIVITY_SURFACE = "home_recent_activity";
const HOME_ACTIVITY_WINDOW_DAYS = 1;
const VISIBLE_ACTIVITY_TYPES = new Set([
  "rsvp_going",
  "rsvp_interested",
  "rsvp_not_going",
]);

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

function activityTimestamp(activity: {
  updatedAt: Date | null;
  createdAt: Date;
}) {
  return activity.updatedAt ?? activity.createdAt;
}

function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function isCurrentOrFutureEventDay(
  event: { startAt: Date; timeZone: string | null; state: string },
  now: Date
) {
  const timeZone = eventTimeZone(event.timeZone, event.state) ?? "America/New_York";
  return localDateKey(event.startAt, timeZone) >= localDateKey(now, timeZone);
}

function getNotGoingReason(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const reason = (metadata as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "3");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 10)
    : 3;
  const previewWindow = Math.min(50, Math.max(limit * 4, limit + 6));
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({
      friendCount: 0,
      requestCount: 0,
      activities: [],
    });
  }

  const now = new Date();
  const recentCutoff = subDays(now, HOME_ACTIVITY_WINDOW_DAYS).getTime();

  const [
    currentUser,
    availableMetroAreas,
    cityCoordinates,
    friendConnections,
    requestCountRow,
    surfaceState,
    pendingFriendRequests,
    pendingPartnerRequests,
  ] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        city: true,
        state: true,
      },
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
    db.query.userFriends.findMany({
      where: and(
        or(eq(userFriends.userId, userId), eq(userFriends.friendUserId, userId)),
        eq(userFriends.status, "accepted")
      ),
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userFriends)
      .where(
        and(eq(userFriends.status, "pending"), eq(userFriends.friendUserId, userId))
      )
      .then(([row]) => row),
    db.query.userSurfaceState.findFirst({
      where: and(
        eq(userSurfaceState.userId, userId),
        eq(userSurfaceState.surface, HOME_RECENT_ACTIVITY_SURFACE)
      ),
    }),
    db.query.userFriends.findMany({
      where: and(
        eq(userFriends.friendUserId, userId),
        eq(userFriends.status, "pending")
      ),
      orderBy: [desc(userFriends.createdAt)],
      with: {
        user: true,
      },
    }),
    db.query.userPartners.findMany({
      where: and(
        eq(userPartners.recipientId, userId),
        eq(userPartners.status, "pending")
      ),
      orderBy: [desc(userPartners.createdAt)],
      with: {
        requester: true,
      },
    }),
  ]);

  const resolveMetroArea = createMobileMetroResolver(
    availableMetroAreas,
    cityCoordinates
  );
  const currentUserLocation =
    currentUser?.city && currentUser?.state
      ? resolveMetroArea({ city: currentUser.city, state: currentUser.state }) ??
        { city: currentUser.city, state: currentUser.state }
      : null;
  const friendIds = friendConnections.map((friendship) =>
    friendship.userId === userId ? friendship.friendUserId : friendship.userId
  );
  const friendIdSet = new Set(friendIds);
  const activityList =
    friendIds.length > 0
      ? await db.query.userActivity.findMany({
          where: and(
            eq(userActivity.entityType, "event"),
            inArray(userActivity.actorUserId, friendIds),
            sql`${userActivity.type} in ('rsvp_going', 'rsvp_interested', 'rsvp_not_going')`
          ),
          orderBy: [desc(userActivity.updatedAt), desc(userActivity.createdAt)],
          limit: Math.min(previewWindow * 4, 200),
          with: {
            actor: true,
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
        })
      : [];

  const visibleActivities = activityList
    .filter((activity) => {
      if (!VISIBLE_ACTIVITY_TYPES.has(activity.type)) return false;
      if (!activity.event) return false;
      if (activity.actorUserId === userId) return false;
      if (!friendIdSet.has(activity.actorUserId)) return false;
      if (activity.event.visibility !== "public" || activity.event.status !== "active") {
        return false;
      }

      // Match the web home preview: activity for an event remains visible for
      // the event's entire local calendar day, even after its start time.
      return isCurrentOrFutureEventDay(activity.event, now);
    })
    .sort((a, b) => activityTimestamp(b).getTime() - activityTimestamp(a).getTime());

  const activeMissedWindowExpiresAt =
    surfaceState?.missedWindowExpiresAt?.getTime() ?? null;
  const hasActiveMissedWindow =
    surfaceState?.missedWindowStartAt != null &&
    activeMissedWindowExpiresAt != null &&
    activeMissedWindowExpiresAt > now.getTime();
  const activeMissedWindowStartAt = hasActiveMissedWindow
    ? surfaceState?.missedWindowStartAt?.getTime() ?? null
    : null;

  const recentActivities = visibleActivities.filter(
    (activity) => activityTimestamp(activity).getTime() >= recentCutoff
  );
  const missedActivities = hasActiveMissedWindow
    ? visibleActivities.filter((activity) => {
        const timestamp = activityTimestamp(activity).getTime();
        return (
          activeMissedWindowStartAt != null &&
          timestamp > activeMissedWindowStartAt &&
          timestamp < recentCutoff
        );
      })
    : surfaceState?.lastVisitedAt == null
      ? []
      : visibleActivities.filter((activity) => {
          const timestamp = activityTimestamp(activity).getTime();
          return (
            surfaceState.lastVisitedAt != null &&
            timestamp > surfaceState.lastVisitedAt.getTime() &&
            timestamp < recentCutoff
          );
        });

  const shouldStartMissedWindow =
    !hasActiveMissedWindow && missedActivities.length > 0;
  const previewActivities = [...recentActivities, ...missedActivities]
    .filter(
      (activity, index, collection) =>
        collection.findIndex((candidate) => candidate.id === activity.id) === index
    )
    .slice(0, limit);

  const nextMissedWindowStartAt = hasActiveMissedWindow
    ? surfaceState?.missedWindowStartAt ?? null
    : shouldStartMissedWindow
      ? surfaceState?.lastVisitedAt ?? null
      : null;
  const nextMissedWindowExpiresAt = hasActiveMissedWindow
    ? surfaceState?.missedWindowExpiresAt ?? null
    : shouldStartMissedWindow
      ? addDays(now, HOME_ACTIVITY_WINDOW_DAYS)
      : null;

  await db
    .insert(userSurfaceState)
    .values({
      userId,
      surface: HOME_RECENT_ACTIVITY_SURFACE,
      lastVisitedAt: now,
      missedWindowStartAt: nextMissedWindowStartAt,
      missedWindowExpiresAt: nextMissedWindowExpiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userSurfaceState.userId, userSurfaceState.surface],
      set: {
        lastVisitedAt: now,
        missedWindowStartAt: nextMissedWindowStartAt,
        missedWindowExpiresAt: nextMissedWindowExpiresAt,
        updatedAt: now,
      },
    });

  const eventIds = previewActivities
    .map((activity) => activity.event?.id)
    .filter((id): id is string => Boolean(id));
  const actorIdsWithPartnerIncluded = [
    ...new Set(
      previewActivities
        .filter((activity) => {
          const includePartner =
            (activity.metadata as { includePartner?: boolean } | null)
              ?.includePartner === true;
          return includePartner && VISIBLE_ACTIVITY_TYPES.has(activity.type);
        })
        .map((activity) => activity.actorUserId)
    ),
  ];
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
  const currentUserRsvpMap = new Map<
    string,
    { status: string; notGoingReason: string | null }
  >();
  const addSocialRsvp = (
    eventId: string,
    rsvp: {
      userId: string;
      status: "going" | "interested" | "not_going";
      user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        avatarImageUrl: string | null;
        isCurrentUser: boolean;
        isFriend: boolean;
      };
    }
  ) => {
    if (!socialRsvpsMap.has(eventId)) {
      socialRsvpsMap.set(eventId, []);
    }

    const attendees = socialRsvpsMap.get(eventId)!;
    const existingIndex = attendees.findIndex(
      (attendee) => attendee.user.id === rsvp.userId
    );

    if (existingIndex >= 0) {
      if (
        attendees[existingIndex].status === "interested" &&
        rsvp.status === "going"
      ) {
        attendees[existingIndex] = {
          status: rsvp.status,
          user: rsvp.user,
        };
      }
      return;
    }

    attendees.push({
      status: rsvp.status,
      user: rsvp.user,
    });
  };
  const [
    currentUserRsvps,
    mirroredPartnerRsvps,
    friendRsvps,
    followedPlaces,
    partnerRelationships,
  ] = await Promise.all([
    eventIds.length > 0
      ? db.query.eventRsvps.findMany({
          where: and(
            inArray(eventRsvps.eventId, eventIds),
            eq(eventRsvps.userId, userId)
          ),
          with: {
            user: true,
          },
        })
      : Promise.resolve([]),
    eventIds.length > 0
      ? db.query.eventRsvps.findMany({
          where: and(
            inArray(eventRsvps.eventId, eventIds),
            eq(eventRsvps.partnerRsvpByUserId, userId),
            inArray(eventRsvps.status, ["going", "interested", "not_going"])
          ),
          with: {
            user: true,
          },
        })
      : Promise.resolve([]),
    eventIds.length > 0 && friendIds.length > 0
      ? db.query.eventRsvps.findMany({
          where: and(
            inArray(eventRsvps.eventId, eventIds),
            inArray(eventRsvps.userId, friendIds),
            inArray(eventRsvps.status, ["going", "interested", "not_going"])
          ),
          with: {
            user: true,
          },
        })
      : Promise.resolve([]),
    db.query.placeFollows.findMany({
      where: eq(placeFollows.userId, userId),
      columns: {
        placeId: true,
      },
    }),
    actorIdsWithPartnerIncluded.length > 0
      ? db.query.userPartners.findMany({
          where: and(
            eq(userPartners.status, "accepted"),
            or(
              inArray(userPartners.requesterId, actorIdsWithPartnerIncluded),
              inArray(userPartners.recipientId, actorIdsWithPartnerIncluded)
            )
          ),
          with: {
            requester: true,
            recipient: true,
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
    if (!rsvp.user || (rsvp.status !== "going" && rsvp.status !== "interested" && rsvp.status !== "not_going")) {
      continue;
    }

    addSocialRsvp(rsvp.eventId, {
      userId: rsvp.userId,
      status: rsvp.status,
      user: {
        id: rsvp.user.id,
        firstName: rsvp.user.firstName,
        lastName: rsvp.user.lastName,
        avatarImageUrl: rsvp.user.avatarImageUrl,
        isCurrentUser: rsvp.userId === userId,
        isFriend: friendIdSet.has(rsvp.userId),
      },
    });
  }

  const followedPlaceIds = new Set(followedPlaces.map((follow) => follow.placeId));
  const partnerFirstNameByActorId = new Map<string, string>();
  const partnerUserIdByActorId = new Map<string, string>();
  for (const relationship of partnerRelationships) {
    if (
      actorIdsWithPartnerIncluded.includes(relationship.requesterId) &&
      relationship.recipient &&
      friendIdSet.has(relationship.recipientId)
    ) {
      partnerFirstNameByActorId.set(
        relationship.requesterId,
        relationship.recipient.firstName || "their partner"
      );
      partnerUserIdByActorId.set(relationship.requesterId, relationship.recipientId);
    }

    if (
      actorIdsWithPartnerIncluded.includes(relationship.recipientId) &&
      relationship.requester &&
      friendIdSet.has(relationship.requesterId)
    ) {
      partnerFirstNameByActorId.set(
        relationship.recipientId,
        relationship.requester.firstName || "their partner"
      );
      partnerUserIdByActorId.set(relationship.recipientId, relationship.requesterId);
    }
  }
  const editPermissions = await resolveMobileEventEditPermissions(userId);

  const activities = previewActivities.map((activity) => {
    const actorName =
      [activity.actor.firstName, activity.actor.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      activity.actor.username ||
      "Someone";
    const event = mapEventCategoryData(activity.event!);
    const venue = event.venue;
    const currentUserRsvp = currentUserRsvpMap.get(event.id) ?? null;

    return {
      id: activity.id,
      type: activity.type,
      actorUserId: activity.actorUserId,
      actorName,
      actorFirstName: activity.actor.firstName,
      actorGender: activity.actor.gender,
      actorAvatarImageUrl: activity.actor.avatarImageUrl,
      partnerFirstName: partnerFirstNameByActorId.get(activity.actorUserId) ?? null,
      partnerUserId: partnerUserIdByActorId.get(activity.actorUserId) ?? null,
      notGoingReason:
        activity.type === "rsvp_not_going"
          ? getNotGoingReason(activity.metadata)
          : null,
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt,
      event: {
        id: event.id,
        publicId: event.publicId,
        title: event.title,
        description: event.description,
        coverImageUrl: event.coverImageUrl,
        seriesId: event.seriesId,
        eventUrl: event.eventUrl,
        startAt: event.startAt,
        endAt: event.endAt,
        address: event.address,
        city: event.city,
        state: event.state,
        timeZone: event.timeZone,
        venueId: event.venueId,
        venueName: venue?.name ?? null,
        venueSlug: venue?.slug ?? null,
        organizerId: event.organizerId,
        organizerName: event.organizer?.name ?? null,
        organizerSlug: event.organizer?.slug ?? null,
        venueLogoImageUrl: venue?.logoImageUrl ?? null,
        organizerLogoImageUrl: event.organizer?.logoImageUrl ?? null,
        categories: event.categories,
        categoryLabels: event.categoryLabels,
        updatedAt: event.updatedAt,
        canEdit: canEditMobileEvent(editPermissions, {
          venueId: event.venueId,
          organizerId: event.organizerId,
        }),
        isFollowed:
          (event.venueId ? followedPlaceIds.has(event.venueId) : false) ||
          (event.organizerId ? followedPlaceIds.has(event.organizerId) : false),
        userRsvpStatus: currentUserRsvp?.status ?? null,
        userRsvpNotGoingReason: currentUserRsvp?.notGoingReason ?? null,
        friendsGoing: (socialRsvpsMap.get(event.id) ?? []).filter(
          (rsvp) => rsvp.status === "going"
        ),
        friendsInterested: (socialRsvpsMap.get(event.id) ?? []).filter(
          (rsvp) => rsvp.status === "interested"
        ),
        friendsNotGoing: (socialRsvpsMap.get(event.id) ?? []).filter(
          (rsvp) => rsvp.status === "not_going"
        ),
        venue: venue
          ? {
              id: venue.id,
              type: venue.type,
              slug: venue.slug,
              name: venue.name,
              logoImageUrl: venue.logoImageUrl,
              city: venue.city,
              state: venue.state,
              upcomingEventCount: 0,
              updatedAt: venue.updatedAt,
            }
          : null,
      },
    };
  });

  const requestActivities = [
    ...pendingFriendRequests.map((request) => {
      const actorName =
        [request.user?.firstName, request.user?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        request.user?.username ||
        "Someone";

      return {
        id: request.id,
        type: "friend_request_received",
        actorUserId: request.userId,
        actorName,
        actorFirstName: request.user?.firstName ?? null,
        actorGender: request.user?.gender ?? null,
        actorAvatarImageUrl: request.user?.avatarImageUrl ?? null,
        partnerFirstName: null,
        partnerUserId: null,
        notGoingReason: null,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        event: null,
      };
    }),
    ...pendingPartnerRequests.map((request) => {
      const actorName =
        [request.requester?.firstName, request.requester?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        request.requester?.username ||
        "Someone";

      return {
        id: request.id,
        type: "partner_request_received",
        actorUserId: request.requesterId,
        actorName,
        actorFirstName: request.requester?.firstName ?? null,
        actorGender: request.requester?.gender ?? null,
        actorAvatarImageUrl: request.requester?.avatarImageUrl ?? null,
        partnerFirstName: null,
        partnerUserId: null,
        notGoingReason: null,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        event: null,
      };
    }),
  ];

  const allActivities = [...requestActivities, ...activities]
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime()
    )
    .slice(0, limit);

  return NextResponse.json({
    friendCount: friendIds.length,
    requestCount: requestCountRow?.count ?? 0,
    currentUserLocation,
    activities: allActivities,
  });
}
