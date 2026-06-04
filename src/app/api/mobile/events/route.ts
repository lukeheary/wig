import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, or } from "drizzle-orm";
import { db } from "@/server/db";
import {
  eventRsvps,
  events,
  placeFollows,
  userFriends,
  users,
} from "@/server/db/schema";
import { mapEventCategoryData } from "@/server/utils/categories";

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
  const limitParam = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 50)
    : 20;

  const now = new Date();
  const userId = await currentMobileUserId();

  const [currentUser, availableCities] = await Promise.all([
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
        city: events.city,
        state: events.state,
      })
      .from(events)
      .where(
        and(
          eq(events.visibility, "public"),
          eq(events.status, "active"),
          gte(events.startAt, now)
        )
      )
      .groupBy(events.city, events.state)
      .orderBy(asc(events.city), asc(events.state)),
  ]);

  const eventList = await db.query.events.findMany({
    where: and(
      eq(events.visibility, "public"),
      eq(events.status, "active"),
      gte(events.startAt, now)
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

  const eventIds = eventList.map((event) => event.id);
  const socialRsvpsMap = new Map<
    string,
    Array<{
      eventId: string;
      userId: string;
      status: "going" | "interested";
      user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        avatarImageUrl: string | null;
        isCurrentUser: boolean;
        isFriend: boolean;
      };
      isCurrentUser: boolean;
      isFriend: boolean;
    }>
  >();

  const addSocialRsvp = (
    rsvp: {
      eventId: string;
      userId: string;
      status: "going" | "interested";
      user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        avatarImageUrl: string | null;
        isCurrentUser: boolean;
        isFriend: boolean;
      };
      isCurrentUser: boolean;
      isFriend: boolean;
    }
  ) => {
    if (!socialRsvpsMap.has(rsvp.eventId)) {
      socialRsvpsMap.set(rsvp.eventId, []);
    }

    const attendees = socialRsvpsMap.get(rsvp.eventId)!;
    const existingIndex = attendees.findIndex(
      (attendee) => attendee.userId === rsvp.userId
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

  if (userId && eventIds.length > 0) {
    const [currentUserRsvps, mirroredPartnerRsvps, friendConnections] =
      await Promise.all([
        db.query.eventRsvps.findMany({
          where: and(
            inArray(eventRsvps.eventId, eventIds),
            eq(eventRsvps.userId, userId),
            inArray(eventRsvps.status, ["going", "interested"])
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
        db.query.userFriends.findMany({
          where: and(
            or(eq(userFriends.userId, userId), eq(userFriends.friendUserId, userId)),
            eq(userFriends.status, "accepted")
          ),
        }),
      ]);

    const friendIds = friendConnections.map((friendship) =>
      friendship.userId === userId
        ? friendship.friendUserId
        : friendship.userId
    );
    const friendIdSet = new Set(friendIds);

    const friendRsvps =
      friendIds.length > 0
        ? await db.query.eventRsvps.findMany({
            where: and(
              inArray(eventRsvps.eventId, eventIds),
              inArray(eventRsvps.userId, friendIds),
              inArray(eventRsvps.status, ["going", "interested"])
            ),
            with: {
              user: true,
            },
          })
        : [];

    for (const rsvp of [
      ...currentUserRsvps,
      ...mirroredPartnerRsvps,
      ...friendRsvps,
    ]) {
      if (!rsvp.user || (rsvp.status !== "going" && rsvp.status !== "interested")) {
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
          isCurrentUser: rsvp.userId === userId,
          isFriend: friendIdSet.has(rsvp.userId),
        },
        isCurrentUser: rsvp.userId === userId,
        isFriend: friendIdSet.has(rsvp.userId),
      });
    }
  }

  const followedPlaceIds =
    userId && eventIds.length > 0
      ? new Set(
          (
            await db.query.placeFollows.findMany({
              where: eq(placeFollows.userId, userId),
              columns: {
                placeId: true,
              },
            })
          ).map((follow) => follow.placeId)
        )
      : new Set<string>();

  const payload = eventList.map((event) => {
    const mapped = mapEventCategoryData(event);
    const socialRsvps = socialRsvpsMap.get(mapped.id) ?? [];

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
      isFollowed:
        (mapped.venueId ? followedPlaceIds.has(mapped.venueId) : false) ||
        (mapped.organizerId ? followedPlaceIds.has(mapped.organizerId) : false),
      isCreatedByCurrentUser:
        Boolean(userId) && mapped.createdByUserId === userId,
      friendsGoing: socialRsvps.filter((rsvp) => rsvp.status === "going"),
      friendsInterested: socialRsvps.filter(
        (rsvp) => rsvp.status === "interested"
      ),
    };
  });

  return NextResponse.json({
    events: payload,
    availableCities,
    currentUserLocation:
      currentUser?.city && currentUser?.state
        ? {
            city: currentUser.city,
            state: currentUser.state,
          }
        : null,
  });
}
