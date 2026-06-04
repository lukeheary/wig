import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { RSVP_DECLINE_REASON_VALUES } from "@/lib/rsvp";
import { db } from "@/server/db";
import { eventRsvps, events, users } from "@/server/db/schema";
import {
  clearRsvpActivity,
  upsertRsvpActivity,
} from "@/server/utils/activity-logger";
import { notifyFriendsOfRsvp } from "@/server/utils/notifications";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const updateSchema = z.object({
  status: z.enum(["going", "interested", "not_going"]),
  notGoingReason: z.enum(RSVP_DECLINE_REASON_VALUES).nullable().optional(),
  reason: z.enum(RSVP_DECLINE_REASON_VALUES).nullable().optional(),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function currentMobileUserId() {
  const { userId } = await auth();

  if (userId) {
    return userId;
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: {
      id: true,
    },
  });

  return previewUser?.id ?? null;
}

async function validatedEventId(context: RouteContext) {
  const params = await context.params;
  return paramsSchema.parse(params).id;
}

export async function GET(_request: Request, context: RouteContext) {
  const eventId = await validatedEventId(context);
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({ status: null });
  }

  const rsvp = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.userId, userId), eq(eventRsvps.eventId, eventId)),
    columns: {
      status: true,
      notGoingReason: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    status: rsvp?.status ?? null,
    notGoingReason: rsvp?.notGoingReason ?? null,
    updatedAt: rsvp?.updatedAt ?? null,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const eventId = await validatedEventId(context);
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = updateSchema.parse(await request.json());
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
    columns: {
      id: true,
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const existingUserRsvp = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.userId, userId), eq(eventRsvps.eventId, eventId)),
    columns: {
      status: true,
    },
  });

  const notGoingReason =
    body.status === "not_going"
      ? (body.notGoingReason ?? body.reason ?? null)
      : null;

  const [rsvp] = await db
    .insert(eventRsvps)
    .values({
      userId,
      eventId,
      status: body.status,
      notGoingReason,
      partnerRsvpByUserId: null,
    })
    .onConflictDoUpdate({
      target: [eventRsvps.userId, eventRsvps.eventId],
      set: {
        status: body.status,
        notGoingReason,
        partnerRsvpByUserId: null,
        updatedAt: new Date(),
      },
    })
    .returning({
      status: eventRsvps.status,
      notGoingReason: eventRsvps.notGoingReason,
      updatedAt: eventRsvps.updatedAt,
    });

  const activityType =
    body.status === "going"
      ? "rsvp_going"
      : body.status === "interested"
        ? "rsvp_interested"
        : "rsvp_not_going";

  void upsertRsvpActivity({
    actorUserId: userId,
    entityId: eventId,
    type: activityType,
    metadata: {
      status: body.status,
      includePartner: false,
      reason: notGoingReason,
    },
  });

  if (
    (body.status === "going" || body.status === "interested") &&
    existingUserRsvp?.status !== body.status
  ) {
    void notifyFriendsOfRsvp(
      {
        actorUserId: userId,
        eventId,
        status: body.status,
      },
      db
    );
  }

  return NextResponse.json({
    status: rsvp?.status ?? body.status,
    notGoingReason: rsvp?.notGoingReason ?? notGoingReason,
    updatedAt: rsvp?.updatedAt ?? new Date(),
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const eventId = await validatedEventId(context);
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await db
    .delete(eventRsvps)
    .where(and(eq(eventRsvps.userId, userId), eq(eventRsvps.eventId, eventId)));

  void clearRsvpActivity({
    actorUserId: userId,
    entityId: eventId,
  });

  return NextResponse.json({
    status: null,
    notGoingReason: null,
    updatedAt: null,
  });
}
