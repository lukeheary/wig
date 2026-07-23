import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/server/db";
import { placeMembers, places, users } from "@/server/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    await auth();
    const { slug } = await params;

    const place = await db.query.places.findFirst({
      where: eq(places.slug, slug),
      columns: { id: true },
    });

    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    const rows = await db.query.placeMembers.findMany({
      where: eq(placeMembers.placeId, place.id),
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            avatarImageUrl: true,
            city: true,
            state: true,
          },
        },
      },
      orderBy: (pm, { asc }) => [asc(pm.createdAt)],
    });

    const members = rows.map((row) => ({
      id: row.user.id,
      name: [row.user.firstName, row.user.lastName].filter(Boolean).join(" "),
      username: row.user.username ?? "",
      avatarImageUrl: row.user.avatarImageUrl,
      city: row.user.city,
      state: row.user.state,
      role: row.role,
    }));

    return NextResponse.json({ members });
  } catch (error) {
    console.error("GET /api/mobile/places/[slug]/members failed", error);
    return NextResponse.json(
      { error: "Failed to load members." },
      { status: 500 }
    );
  }
}

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["owner", "manager", "promoter", "staff"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { userId: currentUserId } = await auth();

    if (!currentUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, currentUserId),
      columns: { role: true },
    });

    if (currentUser?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { slug } = await params;

    const place = await db.query.places.findFirst({
      where: eq(places.slug, slug),
      columns: { id: true },
    });

    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = addMemberSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { userId, role } = parsed.data;

    const targetUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await db
      .insert(placeMembers)
      .values({ userId, placeId: place.id, role })
      .onConflictDoUpdate({
        target: [placeMembers.userId, placeMembers.placeId],
        set: { role },
      });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/mobile/places/[slug]/members failed", error);
    return NextResponse.json(
      { error: "Failed to add user to place." },
      { status: 500 }
    );
  }
}
