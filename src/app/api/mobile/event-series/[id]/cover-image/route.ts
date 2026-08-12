import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { resolveMobileEventEditPermissions } from "@/app/api/mobile/event-edit-permissions";
import { db } from "@/server/db";
import { eventSeries, events, users } from "@/server/db/schema";

async function currentMobileUserContext() {
  const { userId } = await auth();

  if (userId) {
    return { userId, isPreview: false };
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: { id: true },
  });

  return {
    userId: previewUser?.id ?? null,
    isPreview: true,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, isPreview } = await currentMobileUserContext();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: seriesId } = await params;
    const body = (await request.json()) as { coverImageUrl?: string };
    const coverImageUrl = body.coverImageUrl?.trim();

    if (!coverImageUrl) {
      return NextResponse.json(
        { error: "A cover image URL is required" },
        { status: 400 }
      );
    }

    const series = await db.query.eventSeries.findFirst({
      where: eq(eventSeries.id, seriesId),
    });

    if (!series) {
      return NextResponse.json(
        { error: "Event series not found" },
        { status: 404 }
      );
    }

    if (!isPreview) {
      const permissions = await resolveMobileEventEditPermissions(userId);
      const canManage =
        permissions.isAdmin ||
        series.createdByUserId === userId ||
        [series.venueId, series.organizerId].some(
          (placeId) => placeId && permissions.manageablePlaceIds.has(placeId)
        );

      if (!canManage) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const inheritedImageCondition =
      series.coverImageUrl === null
        ? isNull(events.coverImageUrl)
        : or(
            isNull(events.coverImageUrl),
            eq(events.coverImageUrl, series.coverImageUrl)
          );
    const updatedAt = new Date();

    const [updatedSeries] = await db
      .update(eventSeries)
      .set({ coverImageUrl, updatedAt })
      .where(eq(eventSeries.id, seriesId))
      .returning({
        id: eventSeries.id,
        coverImageUrl: eventSeries.coverImageUrl,
      });

    if (!updatedSeries) {
      return NextResponse.json(
        { error: "Failed to update event series cover image" },
        { status: 500 }
      );
    }

    await db
      .update(events)
      .set({ coverImageUrl, updatedAt })
      .where(and(eq(events.seriesId, seriesId), inheritedImageCondition));

    return NextResponse.json(updatedSeries);
  } catch (error) {
    console.error("Mobile event series cover image error:", error);
    return NextResponse.json(
      { error: "Failed to update event series cover image" },
      { status: 500 }
    );
  }
}
