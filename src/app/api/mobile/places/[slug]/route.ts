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
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import {
  eventReviews,
  eventRsvps,
  events,
  placeFollows,
  placeHomeHides,
  placeMembers,
  places,
  userFriends,
  users,
} from "@/server/db/schema";
import {
  filterExistingCategoryKeys,
  mapEventCategoryData,
  mapPlaceCategoryData,
  setPlaceCategoryKeys,
} from "@/server/utils/categories";
import {
  canEditMobileEvent,
  resolveMobileEventEditPermissions,
  type MobileEventEditPermissions,
} from "@/app/api/mobile/event-edit-permissions";
import {
  INSTAGRAM_HANDLE_ERROR,
  INSTAGRAM_HANDLE_REGEX,
} from "@/lib/place-identifiers";
import { goingRsvpCountsForEventIds } from "@/app/api/mobile/event-rsvp-counts";
import { withStoredImageReplacements } from "@/server/utils/stored-image-lifecycle";

const mobileUpdatePlaceSchema = z
  .object({
    type: z.enum(["venue", "organizer"]),
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().nullable().optional(),
    logoImageUrl: z.string().url().nullable().optional(),
    keepExistingLogo: z.boolean().optional().default(true),
    address: z.string().trim().nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    state: z.string().trim().max(2).nullable().optional(),
    website: z.string().url().nullable().optional(),
    instagram: z
      .string()
      .trim()
      .max(100)
      .refine(
        (value) => !value || INSTAGRAM_HANDLE_REGEX.test(value),
        INSTAGRAM_HANDLE_ERROR
      )
      .nullable()
      .optional(),
    hours: z.any().nullable().optional(),
    categories: z.array(z.string()).optional().default([]),
    isEnabled: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.type === "venue" && !value.city?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "City is required",
        path: ["city"],
      });
    }

    if (value.type === "venue" && !value.state?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "State is required",
        path: ["state"],
      });
    }

    const hasCity = Boolean(value.city?.trim());
    const hasState = Boolean(value.state?.trim());
    if (hasCity !== hasState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "City and state must be provided together",
        path: [hasCity ? "state" : "city"],
      });
    }
  });

async function previewMobileUserId() {
  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: {
      id: true,
    },
  });

  return previewUser?.id ?? null;
}

function mapMobileEvent(
  event: any,
  permissions: MobileEventEditPermissions,
  currentUserRsvp?: {
    status: "going" | "interested" | "not_going";
    notGoingReason: string | null;
  } | null,
  currentUserReview?: typeof eventReviews.$inferSelect | null,
  socialRsvps: Array<{
    status: "going" | "interested" | "not_going";
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
  }> = [],
  goingCount = 0
) {
  const mapped = mapEventCategoryData(event);

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
    status: mapped.status,
    createdAt: mapped.createdAt,
    updatedAt: mapped.updatedAt,
    canEdit: canEditMobileEvent(permissions, {
      venueId: mapped.venueId,
      organizerId: mapped.organizerId,
    }),
    userRsvpStatus: currentUserRsvp?.status ?? null,
    userRsvpNotGoingReason: currentUserRsvp?.notGoingReason ?? null,
    currentUserReview: currentUserReview ?? null,
    goingCount,
    friendsGoing: socialRsvps.filter((rsvp) => rsvp.status === "going"),
    friendsInterested: socialRsvps.filter(
      (rsvp) => rsvp.status === "interested"
    ),
    friendsNotGoing: socialRsvps.filter((rsvp) => rsvp.status === "not_going"),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const place = await db.query.places.findFirst({
    where: eq(places.slug, slug),
    with: {
      categoryLinks: {
        with: {
          category: true,
        },
      },
    },
  });

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const now = new Date();
  const eventCondition =
    place.type === "venue"
      ? eq(events.venueId, place.id)
      : eq(events.organizerId, place.id);

  const upcomingEvents = await db.query.events.findMany({
    where: and(
      eventCondition,
      eq(events.visibility, "public"),
      eq(events.status, "active"),
      gte(events.startAt, now)
    ),
    orderBy: [asc(events.startAt)],
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

  const pastEvents = await db.query.events.findMany({
    where: and(
      eventCondition,
      eq(events.visibility, "public"),
      eq(events.status, "active"),
      lt(events.startAt, now)
    ),
    orderBy: [desc(events.startAt)],
    limit: 12,
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

  const mappedPlace = mapPlaceCategoryData(place);
  const { userId: authenticatedUserId } = await auth();
  const userId = authenticatedUserId ?? (await previewMobileUserId());
  const editPermissions =
    await resolveMobileEventEditPermissions(authenticatedUserId);
  const canManagePlace =
    editPermissions.isAdmin || editPermissions.manageablePlaceIds.has(place.id);
  const allEvents = [...upcomingEvents, ...pastEvents];
  const eventIds = allEvents.map((event) => event.id);
  const goingRsvpCounts = await goingRsvpCountsForEventIds(eventIds);
  const socialRsvpsMap = new Map<
    string,
    Array<{
      eventId: string;
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
      isCurrentUser: boolean;
      isFriend: boolean;
    }>
  >();
  const currentUserRsvpMap =
    userId && eventIds.length > 0
      ? new Map(
          (
            await db.query.eventRsvps.findMany({
              where: and(
                inArray(eventRsvps.eventId, eventIds),
                eq(eventRsvps.userId, userId)
              ),
              columns: {
                eventId: true,
                status: true,
                notGoingReason: true,
              },
            })
          ).map((rsvp) => [
            rsvp.eventId,
            {
              status: rsvp.status,
              notGoingReason: rsvp.notGoingReason,
            },
          ])
        )
      : new Map();
  const currentUserReviewMap =
    userId && eventIds.length > 0
      ? new Map(
          (
            await db.query.eventReviews.findMany({
              where: and(
                inArray(eventReviews.eventId, eventIds),
                eq(eventReviews.userId, userId),
                isNotNull(eventReviews.rating)
              ),
            })
          ).map((review) => [review.eventId, review])
        )
      : new Map();

  const addSocialRsvp = (rsvp: {
    eventId: string;
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
    isCurrentUser: boolean;
    isFriend: boolean;
  }) => {
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
        db.query.userFriends.findMany({
          where: and(
            or(
              eq(userFriends.userId, userId),
              eq(userFriends.friendUserId, userId)
            ),
            eq(userFriends.status, "accepted")
          ),
        }),
      ]);

    const friendIds = friendConnections.map((friendship) =>
      friendship.userId === userId ? friendship.friendUserId : friendship.userId
    );
    const friendIdSet = new Set(friendIds);

    const friendRsvps =
      friendIds.length > 0
        ? await db.query.eventRsvps.findMany({
            where: and(
              inArray(eventRsvps.eventId, eventIds),
              inArray(eventRsvps.userId, friendIds),
              inArray(eventRsvps.status, ["going", "interested", "not_going"])
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
          isCurrentUser: rsvp.userId === userId,
          isFriend: friendIdSet.has(rsvp.userId),
        },
        isCurrentUser: rsvp.userId === userId,
        isFriend: friendIdSet.has(rsvp.userId),
      });
    }
  }

  const [followerCountResult, memberCountResult, follow, homeHide] =
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(placeFollows)
        .where(eq(placeFollows.placeId, place.id)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(placeMembers)
        .where(eq(placeMembers.placeId, place.id)),
      userId
        ? db.query.placeFollows.findFirst({
            where: and(
              eq(placeFollows.userId, userId),
              eq(placeFollows.placeId, place.id)
            ),
            columns: {
              id: true,
            },
          })
        : Promise.resolve(null),
      authenticatedUserId
        ? db.query.placeHomeHides.findFirst({
            where: and(
              eq(placeHomeHides.userId, authenticatedUserId),
              eq(placeHomeHides.placeId, place.id)
            ),
            columns: {
              id: true,
            },
          })
        : Promise.resolve(null),
    ]);

  return NextResponse.json({
    id: mappedPlace.id,
    type: mappedPlace.type,
    slug: mappedPlace.slug,
    name: mappedPlace.name,
    description: mappedPlace.description,
    logoImageUrl: mappedPlace.logoImageUrl,
    coverImageUrl: mappedPlace.coverImageUrl,
    address: mappedPlace.address,
    city: mappedPlace.city,
    state: mappedPlace.state,
    website: mappedPlace.website,
    instagram: mappedPlace.instagram,
    hours: place.hours ?? null,
    categories: mappedPlace.categories,
    categoryLabels: mappedPlace.categoryLabels,
    updatedAt: mappedPlace.updatedAt,
    followerCount: followerCountResult[0]?.count ?? 0,
    memberCount: memberCountResult[0]?.count ?? 0,
    isEnabled: place.isEnabled,
    isFollowed: Boolean(follow),
    isHiddenFromHome: Boolean(homeHide),
    canManage: canManagePlace,
    events: upcomingEvents.map((event) =>
      mapMobileEvent(
        event,
        editPermissions,
        currentUserRsvpMap.get(event.id),
        currentUserReviewMap.get(event.id),
        socialRsvpsMap.get(event.id) ?? [],
        goingRsvpCounts.get(event.id) ?? 0
      )
    ),
    pastEvents: pastEvents.map((event) =>
      mapMobileEvent(
        event,
        editPermissions,
        currentUserRsvpMap.get(event.id),
        currentUserReviewMap.get(event.id),
        socialRsvpsMap.get(event.id) ?? [],
        goingRsvpCounts.get(event.id) ?? 0
      )
    ),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const place = await db.query.places.findFirst({
      where: eq(places.slug, slug),
      columns: { id: true, logoImageUrl: true },
    });

    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    const permissions = await resolveMobileEventEditPermissions(userId);
    if (!permissions.isAdmin && !permissions.manageablePlaceIds.has(place.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = mobileUpdatePlaceSchema.parse(await request.json());
    const validCategories = await filterExistingCategoryKeys(
      db,
      body.categories,
      {
        activeOnly: true,
      }
    );

    const nextLogoImageUrl = body.keepExistingLogo
      ? place.logoImageUrl
      : body.logoImageUrl?.trim() || null;
    await withStoredImageReplacements({
      db,
      replacements: [{ oldUrl: place.logoImageUrl, newUrl: nextLogoImageUrl }],
      persist: () =>
        db
          .update(places)
          .set({
            type: body.type,
            name: body.name.trim(),
            description: body.description?.trim() || null,
            logoImageUrl: nextLogoImageUrl,
            address:
              body.type === "venue" ? body.address?.trim() || null : null,
            city: body.city?.trim() || null,
            state: body.state?.trim().toUpperCase() || null,
            website: body.website?.trim() || null,
            instagram: body.instagram?.trim() || null,
            hours: body.type === "venue" ? (body.hours ?? null) : null,
            ...(body.isEnabled !== undefined
              ? { isEnabled: body.isEnabled }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(places.id, place.id)),
    });

    await setPlaceCategoryKeys(db, place.id, validCategories, {
      activeOnly: true,
    });

    return NextResponse.json({ id: place.id, slug });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request" },
        { status: 400 }
      );
    }

    console.error("Mobile update place error:", error);
    return NextResponse.json(
      { error: "Failed to update place" },
      { status: 500 }
    );
  }
}
