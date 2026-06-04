import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { events, places } from "@/server/db/schema";
import { mapEventCategoryData, mapPlaceCategoryData } from "@/server/utils/categories";

function mapMobileEvent(event: any) {
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
    venueName: mapped.venue?.name ?? null,
    organizerName: mapped.organizer?.name ?? null,
    venueLogoImageUrl: mapped.venue?.logoImageUrl ?? null,
    organizerLogoImageUrl: mapped.organizer?.logoImageUrl ?? null,
    categories: mapped.categories,
    categoryLabels: mapped.categoryLabels,
    updatedAt: mapped.updatedAt,
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
    events: upcomingEvents.map(mapMobileEvent),
    pastEvents: pastEvents.map(mapMobileEvent),
  });
}
