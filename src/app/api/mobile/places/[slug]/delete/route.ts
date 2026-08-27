import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { events, places, users } from "@/server/db/schema";
import { resolveMobileEventEditPermissions } from "@/app/api/mobile/event-edit-permissions";

async function currentMobileUserContext() {
  const { userId } = await auth();

  if (userId) {
    return { userId, isPreview: false };
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [users.createdAt],
    columns: {
      id: true,
    },
  });

  return {
    userId: previewUser?.id ?? null,
    isPreview: true,
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { userId } = await currentMobileUserContext();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const place = await db.query.places.findFirst({
      where: eq(places.slug, slug),
      columns: {
        id: true,
        type: true,
      },
    });

    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    const permissions = await resolveMobileEventEditPermissions(userId);
    if (!permissions.isAdmin && !permissions.manageablePlaceIds.has(place.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (
      !permissions.isAdmin &&
      permissions.placeRoleById.get(place.id) === "promoter"
    ) {
      return NextResponse.json(
        { error: "Promoters cannot delete places" },
        { status: 403 }
      );
    }

    const now = new Date();
    const upcomingEvents = await db.query.events.findMany({
      where: and(
        place.type === "venue"
          ? eq(events.venueId, place.id)
          : eq(events.organizerId, place.id),
        gte(events.startAt, now)
      ),
      columns: {
        id: true,
      },
    });

    const upcomingEventIDs = upcomingEvents.map((event) => event.id);
    if (upcomingEventIDs.length > 0) {
      await db.delete(events).where(inArray(events.id, upcomingEventIDs));
    }

    await db.delete(places).where(eq(places.id, place.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete mobile place", error);
    return NextResponse.json(
      { error: "Failed to delete place" },
      { status: 500 }
    );
  }
}
