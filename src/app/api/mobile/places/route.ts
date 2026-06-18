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
import { filterExistingCategoryKeys, setPlaceCategoryKeys } from "@/server/utils/categories";
import {
  INSTAGRAM_HANDLE_ERROR,
  INSTAGRAM_HANDLE_REGEX,
} from "@/lib/place-identifiers";

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

  const userId = await currentMobileUserId();

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
      orderBy: [asc(places.name)],
      limit,
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
  const followedPlaceIds =
    userId && placeIds.length > 0
      ? new Set(
          (
            await db.query.placeFollows.findMany({
              where: and(
                eq(placeFollows.userId, userId),
                inArray(placeFollows.placeId, placeIds)
              ),
              columns: {
                placeId: true,
              },
            })
          ).map((follow) => follow.placeId)
        )
      : new Set<string>();

  const now = new Date();

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
    const eventCount = countByPlaceId.get(place.id) ?? 0;
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
      eventCount,
      upcomingEventCount: eventCount,
      updatedAt: place.updatedAt,
      isFollowed: followedPlaceIds.has(place.id),
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
    const { userId, isPreview } = await currentMobileUserContext();

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

    let slug = cleanedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (slug.length < 3) {
      slug = `${body.type}-${slug}`;
    }

    const existing = await db.query.places.findFirst({
      where: eq(places.slug, slug),
      columns: { id: true },
    });

    if (existing) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
    }

    const validCategories = await filterExistingCategoryKeys(db, body.categories, {
      activeOnly: true,
    });

    const [place] = await db
      .insert(places)
      .values({
        type: body.type,
        slug,
        name: cleanedName,
        description: cleanedDescription,
        logoImageUrl: cleanedLogoImageUrl,
        address: body.type == "venue" ? cleanedAddress : null,
        city: cleanedCity,
        state: cleanedState,
        website: cleanedWebsite,
        instagram: cleanedInstagram,
        hours: body.type === "venue" ? body.hours ?? null : null,
      })
      .returning({ id: places.id });

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

    if (!isPreview) {
      await db
        .insert(placeMembers)
        .values({
          userId,
          placeId: place.id,
          role: "owner",
        })
        .onConflictDoNothing();
    }

    return NextResponse.json({ id: place.id });
  } catch (error) {
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
