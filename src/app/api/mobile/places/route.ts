import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import {
  cities,
  events,
  metroAreas,
  placeFollows,
  placeMembers,
  places,
  users,
} from "@/server/db/schema";
import {
  createMobileMetroResolver,
  mobileMetroAreas,
} from "@/app/api/mobile/metro";
import {
  filterExistingCategoryKeys,
  mapPlaceCategoryData,
  setPlaceCategoryKeys,
} from "@/server/utils/categories";
import {
  INSTAGRAM_HANDLE_ERROR,
  INSTAGRAM_HANDLE_REGEX,
} from "@/lib/place-identifiers";
import {
  enforceMobileContentCreation,
  mobileContentModerationErrorResponse,
} from "@/app/api/mobile/content-moderation";

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

const mobileCreatePlaceSchema = z
  .object({
    type: z.enum(["venue", "organizer"]),
    name: z.string().trim().min(1).max(255),
    aliases: z
      .array(z.string().trim().min(1).max(255))
      .max(25)
      .optional()
      .default([]),
    description: z.string().trim().optional(),
    logoImageUrl: z.string().url().optional(),
    address: z.string().trim().optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(2).optional(),
    website: z.string().url().optional(),
    instagram: z
      .string()
      .trim()
      .max(100)
      .refine(
        (value) => value.length === 0 || INSTAGRAM_HANDLE_REGEX.test(value),
        INSTAGRAM_HANDLE_ERROR
      )
      .optional(),
    hours: z.any().optional().nullable(),
    categories: z.array(z.string()).optional().default([]),
  })
  .superRefine((value, context) => {
    if (value.type === "venue") {
      if (!value.city?.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "City is required",
          path: ["city"],
        });
      }

      if (!value.state?.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "State is required",
          path: ["state"],
        });
      }
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

    if (hasState && value.state!.trim().length !== 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "State must be a 2-letter code",
        path: ["state"],
      });
    }
  });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 200)
    : 100;

  const { userId, isPreview } = await currentMobileUserContext();
  const authenticatedUserId = isPreview ? null : userId;

  const [currentUser, availableMetroAreas, cityCoordinates, placesList] =
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
      db.query.places.findMany({
        where: eq(places.isEnabled, true),
        orderBy: [sql`lower(${places.name})`, asc(places.name)],
        limit,
        with: {
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      }),
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

  if (placesList.length === 0) {
    return NextResponse.json({
      places: [],
      availableCities,
      currentUserLocation: currentUserMetroArea,
    });
  }

  const placeIds = placesList.map((place) => place.id);
  const [followedPlaceIds, memberPlaceIds] = authenticatedUserId
    ? await Promise.all([
        db.query.placeFollows
          .findMany({
            where: and(
              eq(placeFollows.userId, authenticatedUserId),
              inArray(placeFollows.placeId, placeIds)
            ),
            columns: {
              placeId: true,
            },
          })
          .then((follows) => new Set(follows.map((follow) => follow.placeId))),
        db.query.placeMembers
          .findMany({
            where: and(
              eq(placeMembers.userId, authenticatedUserId),
              inArray(placeMembers.placeId, placeIds)
            ),
            columns: {
              placeId: true,
            },
          })
          .then(
            (memberships) =>
              new Set(memberships.map((membership) => membership.placeId))
          ),
      ])
    : [new Set<string>(), new Set<string>()];

  const now = new Date();

  const [followerCounts, memberCounts] = await Promise.all([
    db
      .select({
        placeId: placeFollows.placeId,
        count: sql<number>`count(*)::int`,
      })
      .from(placeFollows)
      .where(inArray(placeFollows.placeId, placeIds))
      .groupBy(placeFollows.placeId),
    db
      .select({
        placeId: placeMembers.placeId,
        count: sql<number>`count(*)::int`,
      })
      .from(placeMembers)
      .where(inArray(placeMembers.placeId, placeIds))
      .groupBy(placeMembers.placeId),
  ]);

  const followerCountByPlaceId = new Map(
    followerCounts.map((row) => [row.placeId, row.count])
  );

  const memberCountByPlaceId = new Map(
    memberCounts.map((row) => [row.placeId, row.count])
  );

  const venueCounts = await db
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
    .groupBy(events.venueId);

  const organizerCounts = await db
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
    .groupBy(events.organizerId);

  const countByPlaceId = new Map<string, number>();

  for (const row of venueCounts) {
    if (row.placeId) {
      countByPlaceId.set(
        row.placeId,
        (countByPlaceId.get(row.placeId) ?? 0) + row.count
      );
    }
  }

  for (const row of organizerCounts) {
    if (row.placeId) {
      countByPlaceId.set(
        row.placeId,
        (countByPlaceId.get(row.placeId) ?? 0) + row.count
      );
    }
  }

  const payload = placesList.map((place) => {
    const mappedPlace = mapPlaceCategoryData(place);
    const eventCount = countByPlaceId.get(place.id) ?? 0;
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
      eventCount,
      upcomingEventCount: eventCount,
      followerCount: followerCountByPlaceId.get(mappedPlace.id) ?? 0,
      memberCount: memberCountByPlaceId.get(mappedPlace.id) ?? 0,
      updatedAt: mappedPlace.updatedAt,
      isFollowed: followedPlaceIds.has(mappedPlace.id),
      isMember: memberPlaceIds.has(mappedPlace.id),
      categories: mappedPlace.categories,
      categoryLabels: mappedPlace.categoryLabels,
    };
  });

  return NextResponse.json({
    places: payload,
    availableCities,
    currentUserLocation: currentUserMetroArea,
  });
}

export async function POST(request: Request) {
  try {
    const { userId } = await currentMobileUserContext();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = mobileCreatePlaceSchema.parse(await request.json());
    const cleanedName = body.name.trim();
    const cleanedDescription = body.description?.trim() || null;
    const cleanedLogoImageUrl = body.logoImageUrl?.trim() || null;
    const cleanedAddress = body.address?.trim() || null;
    const cleanedCity = body.city?.trim() || null;
    const cleanedState = body.state?.trim().toUpperCase() || null;
    const cleanedWebsite = body.website?.trim() || null;
    const cleanedInstagram = body.instagram?.trim() || null;

    await enforceMobileContentCreation(userId, [
      { field: "name", value: cleanedName },
      { field: "description", value: cleanedDescription },
    ]);

    let slug = cleanedInstagram
      ? cleanedInstagram.toLowerCase()
      : cleanedName.toLowerCase().replace(/[^a-z0-9]+/g, "");

    if (slug.length < 3) {
      slug = `${body.type}${slug}`;
    }

    const existing = await db.query.places.findFirst({
      where: eq(places.slug, slug),
      columns: { slug: true },
    });

    if (existing) {
      slug = `${slug}${Math.random().toString(36).slice(2, 7)}`;
    }

    const validCategories = await filterExistingCategoryKeys(
      db,
      body.categories,
      {
        activeOnly: true,
      }
    );

    const [place] = await db
      .insert(places)
      .values({
        type: body.type,
        slug,
        name: cleanedName,
        aliases: body.type === "venue" ? body.aliases : [],
        description: cleanedDescription,
        logoImageUrl: cleanedLogoImageUrl,
        address: body.type == "venue" ? cleanedAddress : null,
        city: cleanedCity,
        state: cleanedState,
        website: cleanedWebsite,
        instagram: cleanedInstagram,
        hours: body.type === "venue" ? (body.hours ?? null) : null,
      })
      .returning({ id: places.id, slug: places.slug });

    if (!place) {
      return NextResponse.json(
        { error: "Failed to create place" },
        { status: 500 }
      );
    }

    if (validCategories.length > 0) {
      await setPlaceCategoryKeys(db, place.id, validCategories, {
        activeOnly: true,
      });
    }

    return NextResponse.json({ id: place.id, slug: place.slug });
  } catch (error) {
    const moderationResponse = mobileContentModerationErrorResponse(error);
    if (moderationResponse) return moderationResponse;

    if (error instanceof z.ZodError) {
      const message = error.issues[0]?.message || "Invalid request";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("Mobile create place error:", error);
    return NextResponse.json(
      { error: "Failed to create place" },
      { status: 500 }
    );
  }
}
