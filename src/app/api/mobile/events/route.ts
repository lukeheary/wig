import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import {
  cities,
  eventReviews,
  eventRsvps,
  events,
  metroAreas,
  placeFollows,
  placeHomeHides,
  userFriends,
  users,
} from "@/server/db/schema";
import {
  createMobileMetroResolver,
  mobileMetroAreas,
} from "@/app/api/mobile/metro";
import {
  canEditMobileEvent,
  resolveMobileEventEditPermissions,
} from "@/app/api/mobile/event-edit-permissions";
import { eventTimeZone } from "@/lib/utils";
import {
  filterExistingCategoryKeys,
  mapEventCategoryData,
  setEventCategoryKeys,
} from "@/server/utils/categories";
import { logEventActivity } from "@/server/utils/event-activity-logger";
import { EVENT_STATUS_VALUES } from "@/lib/event-status";
import { goingRsvpCountsForEventIds } from "@/app/api/mobile/event-rsvp-counts";

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

  const naiveUtcMidnight = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const offset = getTimeZoneOffsetMs(naiveUtcMidnight, timeZone) ?? 0;

  return new Date(naiveUtcMidnight.getTime() - offset);
}

function parseDateParam(value: string | null) {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function currentMobileUserContext() {
  const { userId } = await auth();

  if (userId) {
    return { userId, isPreview: false };
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: {
      id: true,
    },
  });

  return {
    userId: previewUser?.id ?? null,
    isPreview: true,
  };
}

const mobileCreateEventSchema = z.object({
  venueId: z.string().uuid().optional(),
  organizerId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().optional(),
  coverImageUrl: z.string().url().optional(),
  eventUrl: z.string().url().optional(),
  startAt: z.string().min(1),
  endAt: z.string().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2),
  categories: z.array(z.string()).optional().default([]),
  status: z.enum(EVENT_STATUS_VALUES).default("active"),
  timeZone: z.string().trim().min(1).max(64).optional(),
});

function parseDateValue(value: string | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 500)
    : 20;

  const now = new Date();
  const { userId, isPreview } = await currentMobileUserContext();
  const authenticatedUserId = isPreview ? null : userId;

  const [currentUser, availableMetroAreas, cityCoordinates, hiddenPlaces] =
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
      authenticatedUserId
        ? db.query.placeHomeHides.findMany({
            where: eq(placeHomeHides.userId, authenticatedUserId),
            columns: {
              placeId: true,
            },
          })
        : [],
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
  const feedTimeZone =
    eventTimeZone(undefined, currentUserMetroArea?.state) ??
    DEFAULT_MOBILE_FEED_TIME_ZONE;
  const today = startOfDayInTimeZone(now, feedTimeZone);
  const currentFeedTime = getTimeZoneDateTimeParts(now, feedTimeZone);
  const feedStartFloor =
    currentFeedTime && currentFeedTime.hour < 6
      ? new Date(today.getTime() - 24 * 60 * 60 * 1000)
      : today;
  const requestedStartDate = parseDateParam(searchParams.get("startDate"));
  const startDate =
    requestedStartDate && requestedStartDate > feedStartFloor
      ? requestedStartDate
      : feedStartFloor;
  const endDate =
    parseDateParam(searchParams.get("endDate")) ??
    new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const hiddenPlaceIds = hiddenPlaces.map((hiddenPlace) => hiddenPlace.placeId);
  const visiblePlaceCondition =
    hiddenPlaceIds.length > 0
      ? and(
          or(
            isNull(events.venueId),
            notInArray(events.venueId, hiddenPlaceIds)
          ),
          or(
            isNull(events.organizerId),
            notInArray(events.organizerId, hiddenPlaceIds)
          )
        )
      : undefined;

  const eventList = await db.query.events.findMany({
    where: and(
      eq(events.visibility, "public"),
      eq(events.status, "active"),
      gte(events.startAt, startDate),
      lt(events.startAt, endDate),
      visiblePlaceCondition
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
  const currentUserRsvpMap = new Map<
    string,
    {
      status: "going" | "interested" | "not_going";
      notGoingReason: string | null;
    }
  >();
  const currentUserReviewMap = new Map<string, (typeof eventReviews.$inferSelect)>();

  const addSocialRsvp = (
    rsvp: {
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
    const [
      currentUserRsvps,
      currentUserReviews,
      mirroredPartnerRsvps,
      friendConnections,
    ] =
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
        db.query.eventReviews.findMany({
          where: and(
            inArray(eventReviews.eventId, eventIds),
            eq(eventReviews.userId, userId),
            isNotNull(eventReviews.rating)
          ),
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
              inArray(eventRsvps.status, ["going", "interested", "not_going"])
            ),
            with: {
              user: true,
            },
          })
        : [];

    for (const rsvp of currentUserRsvps) {
      currentUserRsvpMap.set(rsvp.eventId, {
        status: rsvp.status,
        notGoingReason: rsvp.notGoingReason,
      });
    }

    for (const review of currentUserReviews) {
      currentUserReviewMap.set(review.eventId, review);
    }

    for (const rsvp of [
      ...currentUserRsvps,
      ...mirroredPartnerRsvps,
      ...friendRsvps,
    ]) {
      if (!rsvp.user || (rsvp.status !== "going" && rsvp.status !== "interested" && rsvp.status !== "not_going")) {
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
  const editPermissions = await resolveMobileEventEditPermissions(userId);

  const payload = eventList.map((event) => {
    const mapped = mapEventCategoryData(event);
    const socialRsvps = socialRsvpsMap.get(mapped.id) ?? [];
    const currentUserRsvp = currentUserRsvpMap.get(mapped.id) ?? null;
    const metroArea = resolveMetroArea({
      city: mapped.city,
      state: mapped.state,
    });

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
      status: mapped.status,
      createdAt: mapped.createdAt,
      updatedAt: mapped.updatedAt,
      canEdit: canEditMobileEvent(editPermissions, {
        venueId: mapped.venueId,
        organizerId: mapped.organizerId,
      }),
      isFollowed:
        (mapped.venueId ? followedPlaceIds.has(mapped.venueId) : false) ||
        (mapped.organizerId ? followedPlaceIds.has(mapped.organizerId) : false),
      isCreatedByCurrentUser:
        Boolean(userId) && mapped.createdByUserId === userId,
      userRsvpStatus: currentUserRsvp?.status ?? null,
      userRsvpNotGoingReason: currentUserRsvp?.notGoingReason ?? null,
      currentUserReview: currentUserReviewMap.get(mapped.id) ?? null,
      goingCount: goingRsvpCounts.get(mapped.id) ?? 0,
      friendsGoing: socialRsvps.filter((rsvp) => rsvp.status === "going"),
      friendsInterested: socialRsvps.filter(
        (rsvp) => rsvp.status === "interested"
      ),
      friendsNotGoing: socialRsvps.filter((rsvp) => rsvp.status === "not_going"),
    };
  });

  return NextResponse.json({
    events: payload,
    availableCities,
    currentUserLocation: currentUserMetroArea,
  });
}

export async function POST(request: Request) {
  try {
    const { userId, isPreview } = await currentMobileUserContext();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = mobileCreateEventSchema.parse(await request.json());
    const startAt = parseDateValue(body.startAt);
    const endAt = parseDateValue(body.endAt);

    if (!startAt) {
      return NextResponse.json(
        { error: "Please choose a valid start time" },
        { status: 400 }
      );
    }

    if (endAt && endAt <= startAt) {
      return NextResponse.json(
        { error: "End time must be after start time" },
        { status: 400 }
      );
    }

    const cleanedTitle = body.title.trim();
    const cleanedCity = body.city.trim();
    const cleanedState = body.state.trim().toUpperCase();
    const cleanedDescription = body.description?.trim() || null;
    const cleanedCoverImageUrl = body.coverImageUrl?.trim() || null;
    const cleanedAddress = body.address?.trim() || null;
    const cleanedEventUrl = body.eventUrl?.trim() || null;
    const resolvedTimeZone =
      body.timeZone?.trim() ||
      eventTimeZone(undefined, cleanedState) ||
      null;

    if (!isPreview) {
      const permissions = await resolveMobileEventEditPermissions(userId);

      if (
        body.venueId &&
        !permissions.isAdmin &&
        !permissions.manageablePlaceIds.has(body.venueId)
      ) {
        return NextResponse.json(
          { error: "You are not a member of this venue" },
          { status: 403 }
        );
      }

      if (
        body.organizerId &&
        !permissions.isAdmin &&
        !permissions.manageablePlaceIds.has(body.organizerId)
      ) {
        return NextResponse.json(
          { error: "You are not a member of this organizer" },
          { status: 403 }
        );
      }
    }

    const validCategories = await filterExistingCategoryKeys(db, body.categories, {
      activeOnly: true,
    });

    const [event] = await db
      .insert(events)
      .values({
        title: cleanedTitle,
        city: cleanedCity,
        state: cleanedState,
        startAt,
        visibility: "public",
        status: body.status,
        createdByUserId: userId,
        description: cleanedDescription,
        coverImageUrl: cleanedCoverImageUrl,
        address: cleanedAddress,
        endAt,
        venueId: body.venueId ?? null,
        organizerId: body.organizerId ?? null,
        eventUrl: cleanedEventUrl,
        timeZone: resolvedTimeZone,
      } as any)
      .returning({ id: events.id });

    if (!event) {
      return NextResponse.json(
        { error: "Failed to create event" },
        { status: 500 }
      );
    }

    if (validCategories.length > 0) {
      await setEventCategoryKeys(db, event.id, validCategories, {
        activeOnly: true,
      });
    }

    void logEventActivity({
      actorUserId: userId,
      eventId: event.id,
      type: "created",
      metadata: {
        status: body.status,
        createdVia: "mobile",
      },
    });

    return NextResponse.json({ id: event.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    console.error("Mobile create event error:", error);
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 }
    );
  }
}
