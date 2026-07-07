import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/server/db";
import { metroAreas, users } from "@/server/db/schema";

const createMetroAreaSchema = z.object({
  name: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2, "State must be a 2-letter code"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMiles: z.number().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        role: true,
      },
    });

    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
