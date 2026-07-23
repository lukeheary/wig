import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/server/db";
import { placeFollows, places } from "@/server/db/schema";

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

    const rows = await db.query.placeFollows.findMany({
      where: eq(placeFollows.placeId, place.id),
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
      orderBy: (pf, { desc }) => [desc(pf.createdAt)],
    });

    const followers = rows.map((row) => ({
      id: row.user.id,
      name: [row.user.firstName, row.user.lastName].filter(Boolean).join(" "),
      username: row.user.username ?? "",
      avatarImageUrl: row.user.avatarImageUrl,
      city: row.user.city,
      state: row.user.state,
    }));

    return NextResponse.json({ followers });
  } catch (error) {
    console.error("GET /api/mobile/places/[slug]/followers failed", error);
    return NextResponse.json(
      { error: "Failed to load followers." },
      { status: 500 }
    );
  }
}
