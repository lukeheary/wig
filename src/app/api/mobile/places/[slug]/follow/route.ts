import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { placeFollows, places } from "@/server/db/schema";
import { logActivity } from "@/server/utils/activity-logger";

const paramsSchema = z.object({
  slug: z.string().min(1),
});

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

async function authenticatedUserId() {
  const { userId } = await auth();
  return userId;
}

async function findPlace(context: RouteContext) {
  const params = paramsSchema.parse(await context.params);

  return db.query.places.findFirst({
    where: eq(places.slug, params.slug),
    columns: {
      id: true,
    },
  });
}

export async function POST(_request: Request, context: RouteContext) {
  const userId = await authenticatedUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const place = await findPlace(context);

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const [follow] = await db
    .insert(placeFollows)
    .values({
      userId,
      placeId: place.id,
    })
    .onConflictDoNothing({
      target: [placeFollows.userId, placeFollows.placeId],
    })
    .returning({
      id: placeFollows.id,
    });

  if (follow) {
    void logActivity({
      actorUserId: userId,
      type: "follow_place",
      entityType: "place",
      entityId: place.id,
      metadata: {},
    });
  }

  return NextResponse.json({
    isFollowed: true,
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const userId = await authenticatedUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const place = await findPlace(context);

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  await db
    .delete(placeFollows)
    .where(and(eq(placeFollows.userId, userId), eq(placeFollows.placeId, place.id)));

  return NextResponse.json({
    isFollowed: false,
  });
}
