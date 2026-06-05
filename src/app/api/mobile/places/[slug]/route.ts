import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { eventRsvps, events, placeFollows, places, users } from "@/server/db/schema";
import { mapEventCategoryData, mapPlaceCategoryData } from "@/server/utils/categories";

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

function mapMobileEvent(
  event: any,
  currentUserRsvp?: {
    status: "going" | "interested" | "not_going";
    notGoingReason: string | null;
  } | null
) {
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
    venueName: mapped.venue?.name ?? null,
    organizerName: mapped.organizer?.name ?? null,
    venueLogoImageUrl: mapped.venue?.logoImageUrl ?? null,
    organizerLogoImageUrl: mapped.organizer?.logoImageUrl ?? null,
    categories: mapped.categories,
    categoryLabels: mapped.categoryLabels,
    updatedAt: mapped.updatedAt,
    userRsvpStatus: currentUserRsvp?.status ?? null,
    userRsvpNotGoingReason: currentUserRsvp?.notGoingReason ?? null,
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
  const userId = await currentMobileUserId();
  const allEvents = [...upcomingEvents, ...pastEvents];
  const eventIds = allEvents.map((event) => event.id);
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
  const follow =
    userId
      ? await db.query.placeFollows.findFirst({
          where: and(
            eq(placeFollows.userId, userId),
            eq(placeFollows.placeId, place.id)
          ),
          columns: {
            id: true,
          },
        })
      : null;

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
    categories: mappedPlace.categories,
    categoryLabels: mappedPlace.categoryLabels,
    updatedAt: mappedPlace.updatedAt,
    isFollowed: Boolean(follow),
    events: upcomingEvents.map((event) =>
      mapMobileEvent(event, currentUserRsvpMap.get(event.id))
    ),
    pastEvents: pastEvents.map((event) =>
      mapMobileEvent(event, currentUserRsvpMap.get(event.id))
    ),
  });
}
