import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/server/db";
import { metroAreas, places, users } from "@/server/db/schema";

const createMetroAreaSchema = z.object({
  name: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2, "State must be a 2-letter code"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMiles: z.number().min(1).max(200),
});

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized", status: 401 } as const;

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true },
  });
  if (user?.role !== "admin") {
    return { error: "Forbidden", status: 403 } as const;
  }

  return null;
}

function distanceMiles(
  lhs: { latitude: number; longitude: number },
  rhs: { latitude: number; longitude: number }
) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = radians(rhs.latitude - lhs.latitude);
  const longitudeDelta = radians(rhs.longitude - lhs.longitude);
  const lhsLatitude = radians(lhs.latitude);
  const rhsLatitude = radians(rhs.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(lhsLatitude) *
      Math.cos(rhsLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.sqrt(a));
}

export async function GET() {
  try {
    const authorizationError = await requireAdmin();
    if (authorizationError) {
      return NextResponse.json(
        { error: authorizationError.error },
        { status: authorizationError.status }
      );
    }

    const [metros, placeLocations] = await Promise.all([
      db
        .select()
        .from(metroAreas)
        .orderBy(asc(metroAreas.name), asc(metroAreas.state)),
      db
        .select({
          city: places.city,
          state: places.state,
          latitude: places.latitude,
          longitude: places.longitude,
        })
        .from(places),
    ]);

    return NextResponse.json({
      metroAreas: metros.map((metro) => ({
        ...metro,
        placeCount: placeLocations.filter((place) => {
          if (place.latitude != null && place.longitude != null) {
            return (
              distanceMiles(metro, {
                latitude: place.latitude,
                longitude: place.longitude,
              }) <= metro.radiusMiles
            );
          }
          return (
            place.city?.trim().toLowerCase() ===
              metro.name.trim().toLowerCase() &&
            place.state?.trim().toUpperCase() ===
              metro.state.trim().toUpperCase()
          );
        }).length,
      })),
    });
  } catch (error) {
    console.error("GET /api/mobile/admin/metro-areas failed", error);
    return NextResponse.json(
      { error: "Failed to load metro areas." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const authorizationError = await requireAdmin();
    if (authorizationError) {
      return NextResponse.json(
        { error: authorizationError.error },
        { status: authorizationError.status }
      );
    }

    const payload = await request.json();
    const input = createMetroAreaSchema.parse(payload);
    const normalizedInput = {
      ...input,
      state: input.state.toUpperCase(),
    };

    const existing = await db.query.metroAreas.findFirst({
      where: and(
        eq(metroAreas.name, normalizedInput.name),
        eq(metroAreas.state, normalizedInput.state)
      ),
    });

    if (existing) {
      return NextResponse.json(
        { error: "A metro area with this name and state already exists" },
        { status: 409 }
      );
    }

    const [metroArea] = await db
      .insert(metroAreas)
      .values(normalizedInput)
      .returning();

    return NextResponse.json(metroArea);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid metro area payload" },
        { status: 400 }
      );
    }

    console.error("POST /api/mobile/admin/metro-areas failed", error);
    return NextResponse.json(
      { error: "Failed to create metro area." },
      { status: 500 }
    );
  }
}
