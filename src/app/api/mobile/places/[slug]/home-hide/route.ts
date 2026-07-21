import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { placeHomeHides, places } from "@/server/db/schema";

const paramsSchema = z.object({
  slug: z.string().min(1),
});

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

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
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const place = await findPlace(context);

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  await db
    .insert(placeHomeHides)
    .values({
      userId,
      placeId: place.id,
    })
    .onConflictDoNothing({
      target: [placeHomeHides.userId, placeHomeHides.placeId],
    });

  return NextResponse.json({
    isHiddenFromHome: true,
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const place = await findPlace(context);

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  await db
    .delete(placeHomeHides)
    .where(
      and(
        eq(placeHomeHides.userId, userId),
        eq(placeHomeHides.placeId, place.id)
      )
    );

  return NextResponse.json({
    isHiddenFromHome: false,
  });
}
