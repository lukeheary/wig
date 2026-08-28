import { auth } from "@clerk/nextjs/server";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveMobileEventEditPermissions } from "@/app/api/mobile/event-edit-permissions";
import { db } from "@/server/db";
import { places, users } from "@/server/db/schema";
import {
  enforceMobileContentCreation,
  mobileContentModerationErrorResponse,
} from "@/app/api/mobile/content-moderation";

async function currentMobileUserContext() {
  const { userId } = await auth();
  if (userId) return { userId, isPreview: false };

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: { id: true },
  });

  return { userId: previewUser?.id ?? null, isPreview: true };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { userId, isPreview } = await currentMobileUserContext();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await enforceMobileContentCreation(userId, []);

    const { slug } = await params;
    const body = (await request.json()) as { logoImageUrl?: string };
    const logoImageUrl = body.logoImageUrl?.trim();

    if (!logoImageUrl) {
      return NextResponse.json(
        { error: "A logo image URL is required" },
        { status: 400 }
      );
    }

    const place = await db.query.places.findFirst({
      where: eq(places.slug, slug),
      columns: { id: true },
    });

    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    if (!isPreview) {
      const permissions = await resolveMobileEventEditPermissions(userId);
      if (
        !permissions.isAdmin &&
        !permissions.manageablePlaceIds.has(place.id)
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (
        !permissions.isAdmin &&
        permissions.placeRoleById.get(place.id) === "promoter"
      ) {
        return NextResponse.json(
          { error: "Promoters cannot change place images" },
          { status: 403 }
        );
      }
    }

    await db
      .update(places)
      .set({ logoImageUrl, updatedAt: new Date() })
      .where(eq(places.id, place.id));

    return NextResponse.json({ id: place.id, logoImageUrl });
  } catch (error) {
    const moderationResponse = mobileContentModerationErrorResponse(error);
    if (moderationResponse) return moderationResponse;
    console.error("Mobile place logo image error:", error);
    return NextResponse.json(
      { error: "Failed to update place logo image" },
      { status: 500 }
    );
  }
}
