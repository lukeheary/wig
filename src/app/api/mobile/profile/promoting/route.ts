import { promoUrlSchema } from "@/server/utils/promo-validation";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, lt, or } from "drizzle-orm";
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

function promotionWeekRange(offset: number) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(
    start.getUTCDate() - ((start.getUTCDay() + 6) % 7) + offset * 7
  );
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const placeIds = await promoterPlaceIds(userId);
  if (placeIds.length === 0)
    return NextResponse.json({ events: [], hasMore: false });
  const params = new URL(request.url).searchParams;
  const eventId = params.get("eventId");
  if (
    eventId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      eventId
    )
  ) {
    return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
  }
  const weekOffset = Math.max(
    0,
    Math.min(52, Number(params.get("weekOffset") ?? 0) || 0)
  );
  const { start, end } = promotionWeekRange(weekOffset);
  const eventConditions = [
    or(
      inArray(events.venueId, placeIds),
      inArray(events.organizerId, placeIds)
    ),
    gte(events.startAt, new Date()),
    eq(events.visibility, "public"),
    eq(events.status, "active"),
    ...(eventId
      ? [eq(events.id, eventId)]
      : [gte(events.startAt, start), lt(events.startAt, end)]),
  ];

  const [eligibleEvents, selections, laterEvent] = await Promise.all([
    db.query.events.findMany({
      where: and(...eventConditions),
      with: { venue: true, organizer: true },
      orderBy: [asc(events.startAt)],
    }),
    db.query.userPromotedEvents.findMany({
      where: eq(userPromotedEvents.userId, userId),
      columns: { eventId: true, promo: true, promoUrl: true },
    }),
    eventId
      ? null
      : db.query.events.findFirst({
          where: and(
            or(
              inArray(events.venueId, placeIds),
              inArray(events.organizerId, placeIds)
            ),
            gte(events.startAt, end),
            eq(events.visibility, "public"),
            eq(events.status, "active")
          ),
          columns: { id: true },
        }),
  ]);
  const selectedIds = new Set(selections.map((selection) => selection.eventId));

  return NextResponse.json({
    hasMore: Boolean(laterEvent),
    events: eligibleEvents.map((event) => ({
      id: event.id,
      title: event.title,
      coverImageUrl: event.coverImageUrl,
      startAt: event.startAt,
      placeName: event.venue?.name ?? event.organizer?.name ?? null,
      isPromoted: selectedIds.has(event.id),
      promoUrl:
        selections.find((selection) => selection.eventId === event.id)
          ?.promoUrl ?? null,
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
    (typeof body.promo !== "string" || body.promo.length > 70)
  ) {
    return NextResponse.json(
      { error: "Promo must be 70 characters or fewer." },
      { status: 400 }
    );
  }

  const promoUrlResult = promoUrlSchema.safeParse(body.promoUrl);
  if (!promoUrlResult.success) {
    return NextResponse.json(
      {
        error:
          "Promo link must be a valid HTTP or HTTPS URL (up to 2048 characters).",
      },
      { status: 400 }
    );
  }

  try {
    assertTextContentAllowed([
      {
        field: "promo",
        value:
          body.promoted && typeof body.promo === "string" ? body.promo : null,
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
    return NextResponse.json({ promoted: false, promo: null, promoUrl: null });
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
        ...(promoUrlResult.data !== undefined
          ? { promoUrl: promoUrlResult.data }
          : {}),
        promo:
          typeof body.promo === "string" ? body.promo.trim() || null : null,
      },
    });
  return NextResponse.json({
    promoted: true,
    promo: typeof body.promo === "string" ? body.promo.trim() || null : null,
    promoUrl: promoUrlResult.data ?? null,
  });
}
