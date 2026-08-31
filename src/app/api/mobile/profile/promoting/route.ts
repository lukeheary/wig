import { promoUrlSchema } from "@/server/utils/promo-validation";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, or } from "drizzle-orm";
import { db } from "@/server/db";
import { events, placeMembers, userPromotedEvents } from "@/server/db/schema";
import {
  assertTextContentAllowed,
  CONTENT_MODERATION_REJECTION_MESSAGE,
  isContentModerationError,
} from "@/server/utils/content-moderation";

async function promoterPlaceIds(userId: string) {
  const memberships = await db.query.placeMembers.findMany({
    where: and(
      eq(placeMembers.userId, userId),
      eq(placeMembers.role, "promoter")
    ),
    columns: { placeId: true },
  });
  return memberships.map((membership) => membership.placeId);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const placeIds = await promoterPlaceIds(userId);
  if (placeIds.length === 0) return NextResponse.json({ events: [] });

  const [eligibleEvents, selections] = await Promise.all([
    db.query.events.findMany({
      where: and(
        or(
          inArray(events.venueId, placeIds),
          inArray(events.organizerId, placeIds)
        ),
        gte(events.startAt, new Date()),
        eq(events.visibility, "public"),
        eq(events.status, "active")
      ),
      with: { venue: true, organizer: true },
      orderBy: [asc(events.startAt)],
    }),
    db.query.userPromotedEvents.findMany({
      where: eq(userPromotedEvents.userId, userId),
      columns: { eventId: true, promo: true, promoUrl: true },
    }),
  ]);
  const selectedIds = new Set(selections.map((selection) => selection.eventId));

  return NextResponse.json({
    events: eligibleEvents.map((event) => ({
      id: event.id,
      title: event.title,
      coverImageUrl: event.coverImageUrl,
      startAt: event.startAt,
      placeName: event.venue?.name ?? event.organizer?.name ?? null,
      isPromoted: selectedIds.has(event.id),
      promoUrl: selections.find((selection) => selection.eventId === event.id)?.promoUrl ?? null,
      promo:
        selections.find((selection) => selection.eventId === event.id)?.promo ??
        null,
    })),
  });
}

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    eventId?: unknown;
    promoted?: unknown;
    promo?: unknown;
    promoUrl?: unknown;
  };
  if (typeof body.eventId !== "string" || typeof body.promoted !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (
    body.promo !== undefined &&
    body.promo !== null &&
    (typeof body.promo !== "string" || body.promo.length > 255)
  ) {
    return NextResponse.json(
      { error: "Promo must be 255 characters or fewer." },
      { status: 400 }
    );
  }

  const promoUrlResult = promoUrlSchema.safeParse(body.promoUrl);
  if (!promoUrlResult.success) {
    return NextResponse.json({ error: "Promo link must be a valid HTTP or HTTPS URL (up to 2048 characters)." }, { status: 400 });
  }

  try {
    assertTextContentAllowed([
      {
        field: "promo",
        value: body.promoted && typeof body.promo === "string" ? body.promo : null,
        rejectProfanity: true,
      },
    ]);
  } catch (error) {
    if (isContentModerationError(error)) {
      return NextResponse.json(
        { error: CONTENT_MODERATION_REJECTION_MESSAGE },
        { status: 400 }
      );
    }
    throw error;
  }

  if (!body.promoted) {
    await db
      .delete(userPromotedEvents)
      .where(
        and(
          eq(userPromotedEvents.userId, userId),
          eq(userPromotedEvents.eventId, body.eventId)
        )
      );
    return NextResponse.json({ promoted: false });
  }

  const event = await db.query.events.findFirst({
    where: and(
      eq(events.id, body.eventId),
      gte(events.startAt, new Date()),
      eq(events.visibility, "public"),
      eq(events.status, "active")
    ),
    columns: { venueId: true, organizerId: true },
  });
  const eventPlaceIds = [event?.venueId, event?.organizerId].filter(
    (placeId): placeId is string => Boolean(placeId)
  );
  const allowedPlaceIds = await promoterPlaceIds(userId);
  if (!eventPlaceIds.some((placeId) => allowedPlaceIds.includes(placeId))) {
    return NextResponse.json(
      {
        error:
          "You can only promote events for places where you are a promoter.",
      },
      { status: 403 }
    );
  }

  await db
    .insert(userPromotedEvents)
    .values({
      userId,
      eventId: body.eventId,
      promoUrl: promoUrlResult.data ?? null,
      promo: typeof body.promo === "string" ? body.promo.trim() || null : null,
    })
    .onConflictDoUpdate({
      target: [userPromotedEvents.userId, userPromotedEvents.eventId],
      set: {
        ...(promoUrlResult.data !== undefined ? { promoUrl: promoUrlResult.data } : {}),
        promo:
          typeof body.promo === "string" ? body.promo.trim() || null : null,
      },
    });
  return NextResponse.json({ promoted: true });
}
