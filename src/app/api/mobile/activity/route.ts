import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  cities,
  eventRsvps,
  metroAreas,
  notifications,
  userActivity,
  userFriends,
  userPartners,
  users,
  placeFollows,
} from "@/server/db/schema";
import { mapEventCategoryData } from "@/server/utils/categories";
import {
  canEditMobileEvent,
  resolveMobileEventEditPermissions,
} from "@/app/api/mobile/event-edit-permissions";
import { createMobileMetroResolver } from "@/app/api/mobile/metro";

const VISIBLE_ACTIVITY_TYPES = new Set([
  "rsvp_going",
  "rsvp_interested",
  "rsvp_not_going",
]);

function getNotGoingReason(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const reason = (metadata as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 100)
    : 40;
  const userId = await currentMobileUserId();

  const [requestCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userFriends)
    .where(
      userId
        ? and(
            eq(userFriends.status, "pending"),
            eq(userFriends.friendUserId, userId)
          )
        : sql`false`
    );

  const [
    currentUser,
    availableMetroAreas,
    cityCoordinates,
    friendConnections,
    pendingFriendRequests,
    pendingPartnerRequests,
    acceptedFriendRequests,
    acceptedPartnerRequests,
  ] = await Promise.all([
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
    userId
      ? db.query.userFriends.findMany({
          where: and(
            or(eq(userFriends.userId, userId), eq(userFriends.friendUserId, userId)),
            eq(userFriends.status, "accepted")
          ),
        })
      : Promise.resolve([]),
    userId
      ? db.query.userFriends.findMany({
          where: and(
            eq(userFriends.friendUserId, userId),
            eq(userFriends.status, "pending")
          ),
          orderBy: [desc(userFriends.createdAt)],
          with: {
            user: true,
          },
        })
      : Promise.resolve([]),
    userId
      ? db.query.userPartners.findMany({
          where: and(
            eq(userPartners.recipientId, userId),
            eq(userPartners.status, "pending")
          ),
          orderBy: [desc(userPartners.createdAt)],
          with: {
            requester: true,
          },
        })
      : Promise.resolve([]),
    userId
      ? db.query.userFriends.findMany({
          where: and(
            eq(userFriends.friendUserId, userId),
            eq(userFriends.status, "accepted")
          ),
          orderBy: [desc(userFriends.updatedAt)],
          with: {
            user: true,
          },
        })
      : Promise.resolve([]),
    userId
      ? db.query.userPartners.findMany({
          where: and(
            eq(userPartners.recipientId, userId),
            eq(userPartners.status, "accepted")
          ),
          orderBy: [desc(userPartners.updatedAt)],
          with: {
            requester: true,
          },
        })
      : Promise.resolve([]),
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
          limit: Math.min(limit * 4, 400),
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

  const visibleActivities = activityList.filter((activity) => {
    if (!VISIBLE_ACTIVITY_TYPES.has(activity.type)) return false;
    if (!activity.event) return false;
    if (userId && activity.actorUserId === userId) return false;
    if (!friendIdSet.has(activity.actorUserId)) return false;
    return activity.event.visibility === "public" && activity.event.status === "active";
  });

  const supportNotifications = userId
    ? await db.query.notifications.findMany({
        where: and(
          eq(notifications.userId, userId),
          eq(notifications.entityType, "support_ticket"),
          or(
            // Cast to text so older databases can evaluate this branch even
            // when their enum does not contain support_ticket_created.
            sql`${notifications.type}::text = 'support_ticket_created'`,
            and(
              eq(notifications.type, "support_ticket_status_changed"),
              sql`${notifications.metadata} ->> 'notificationKind' = 'support_ticket_created'`
            )
          )
        ),
        orderBy: [desc(notifications.createdAt)],
        limit: 50,
        with: { actor: true },
      })
    : [];

  const eventIds = visibleActivities
    .map((activity) => activity.event?.id)
    .filter((id): id is string => Boolean(id));
  const actorIdsWithPartnerIncluded = [
    ...new Set(
      visibleActivities
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
  ] =
    userId && eventIds.length > 0
      ? await Promise.all([
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
              inArray(eventRsvps.status, ["going", "interested", "not_going"])
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
        ])
      : [[], [], [], [], []];

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

  const eventActivities = visibleActivities.map((activity) => {
      const actorName =
        [activity.actor.firstName, activity.actor.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        activity.actor.username ||
        "Someone";

      const event = mapEventCategoryData(activity.event);
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
    ...acceptedFriendRequests
      .filter((request) => request.updatedAt.getTime() > request.createdAt.getTime())
      .map((request) => {
        const actorName =
          [request.user?.firstName, request.user?.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          request.user?.username ||
          "Someone";

        return {
          id: request.id,
          type: "friend_request_accepted",
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
    ...acceptedPartnerRequests
      .filter((request) => request.updatedAt.getTime() > request.createdAt.getTime())
      .map((request) => {
        const actorName =
          [request.requester?.firstName, request.requester?.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          request.requester?.username ||
          "Someone";

        return {
          id: request.id,
          type: "partner_request_accepted",
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

  const supportActivities = supportNotifications.map((notification) => {
    const actorName =
      [notification.actor?.firstName, notification.actor?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      notification.actor?.username ||
      "A user";

    return {
      id: notification.id,
      type: "support_ticket_created",
      actorUserId: notification.actorUserId ?? userId ?? "support",
      actorName,
      actorFirstName: notification.actor?.firstName ?? null,
      actorGender: notification.actor?.gender ?? null,
      actorAvatarImageUrl: notification.actor?.avatarImageUrl ?? null,
      partnerFirstName: null,
      partnerUserId: null,
      notGoingReason: null,
      createdAt: notification.createdAt,
      updatedAt: null,
      event: null,
      supportTicketId: notification.entityId,
      notificationBody: notification.body,
    };
  });

  const activities = [...supportActivities, ...requestActivities, ...eventActivities]
    .sort(
      (lhs, rhs) =>
        new Date(rhs.updatedAt ?? rhs.createdAt).getTime() -
        new Date(lhs.updatedAt ?? lhs.createdAt).getTime()
    )
    .slice(0, limit);

  return NextResponse.json({
    friendCount: friendIds.length,
    requestCount: requestCountRow?.count ?? 0,
    currentUserLocation,
    activities,
  });
}
