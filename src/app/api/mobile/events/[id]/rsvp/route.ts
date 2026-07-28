import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { RSVP_DECLINE_REASON_VALUES } from "@/lib/rsvp";
import { db } from "@/server/db";
import { eventRsvps, events, userPartners, users } from "@/server/db/schema";
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
  includePartner: z.boolean().optional(),
  notifyFriends: z.boolean().optional(),
  notificationOnly: z.boolean().optional(),
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
    return NextResponse.json({
      status: null,
      notGoingReason: null,
      includePartner: false,
      updatedAt: null,
    });
  }

  const rsvp = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.userId, userId), eq(eventRsvps.eventId, eventId)),
    columns: {
      status: true,
      notGoingReason: true,
      partnerRsvpByUserId: true,
      updatedAt: true,
    },
  });

  const partnerRelationship = await db.query.userPartners.findFirst({
    where: and(
      eq(userPartners.status, "accepted"),
      or(eq(userPartners.requesterId, userId), eq(userPartners.recipientId, userId))
    ),
  });

  const partnerUserId = partnerRelationship
    ? partnerRelationship.requesterId === userId
      ? partnerRelationship.recipientId
      : partnerRelationship.requesterId
    : null;
  const mirroredPartnerRsvpExists = partnerUserId && rsvp?.status
    ? await db.query.eventRsvps.findFirst({
        where: and(
          eq(eventRsvps.userId, partnerUserId),
          eq(eventRsvps.eventId, eventId),
          eq(eventRsvps.partnerRsvpByUserId, userId),
          eq(eventRsvps.status, rsvp.status)
        ),
        columns: {
          userId: true,
        },
      })
    : null;

  const includePartner =
    Boolean(partnerUserId) &&
    (rsvp?.partnerRsvpByUserId === partnerUserId || Boolean(mirroredPartnerRsvpExists));

  return NextResponse.json({
    status: rsvp?.status ?? null,
    notGoingReason: rsvp?.notGoingReason ?? null,
    includePartner,
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
      startAt: true,
      endAt: true,
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const eventHasEnded = (event.endAt ?? event.startAt) <= new Date();
  const shouldNotifyFriends = body.notifyFriends !== false && !eventHasEnded;

  const existingUserRsvp = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.userId, userId), eq(eventRsvps.eventId, eventId)),
    columns: {
      status: true,
    },
  });

  const partnerRelationship = await db.query.userPartners.findFirst({
    where: and(
      eq(userPartners.status, "accepted"),
      or(eq(userPartners.requesterId, userId), eq(userPartners.recipientId, userId))
    ),
  });

  const partnerUserId = partnerRelationship
    ? partnerRelationship.requesterId === userId
      ? partnerRelationship.recipientId
      : partnerRelationship.requesterId
    : null;

  // The mobile client saves the RSVP immediately, then gives the user a brief
  // undo window before sending the social notification. Re-check the persisted
  // RSVP here so an undone or changed response never notifies friends.
  if (body.notificationOnly) {
    if (
      eventHasEnded ||
      (body.status !== "going" && body.status !== "interested") ||
      existingUserRsvp?.status !== body.status
    ) {
      return NextResponse.json({ notified: false });
    }

    const mirroredPartnerRsvp = partnerUserId
      ? await db.query.eventRsvps.findFirst({
          where: and(
            eq(eventRsvps.userId, partnerUserId),
            eq(eventRsvps.eventId, eventId),
            eq(eventRsvps.partnerRsvpByUserId, userId),
            eq(eventRsvps.status, body.status)
          ),
          columns: { userId: true },
        })
      : null;

    await upsertRsvpActivity({
      actorUserId: userId,
      entityId: eventId,
      type: body.status === "going" ? "rsvp_going" : "rsvp_interested",
      metadata: {
        status: body.status,
        includePartner: Boolean(mirroredPartnerRsvp),
        reason: null,
        notifyFriends: true,
      },
    });

    await notifyFriendsOfRsvp(
      {
        actorUserId: userId,
        eventId,
        status: body.status,
        partnerUserId: mirroredPartnerRsvp ? partnerUserId : null,
      },
      db
    );

    return NextResponse.json({ notified: true });
  }
  const shouldMirrorPartnerRsvp =
    !eventHasEnded && Boolean(partnerUserId) && body.includePartner === true;

  const notGoingReason =
    body.status === "not_going"
      ? (body.notGoingReason ?? body.reason ?? null)
      : null;

  let includedPartnerInRsvp = false;

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
      partnerRsvpByUserId: eventRsvps.partnerRsvpByUserId,
      updatedAt: eventRsvps.updatedAt,
    });

  if (partnerUserId) {
    if (shouldMirrorPartnerRsvp) {
      const existingPartnerRsvp = await db.query.eventRsvps.findFirst({
        where: and(
          eq(eventRsvps.userId, partnerUserId),
          eq(eventRsvps.eventId, eventId)
        ),
      });

      // A partner may have RSVP'd independently before the current user enables
      // the shared RSVP toggle. When both responses already match, adopt that
      // RSVP so future status changes can update the pair together.
      const canWriteMirroredRsvp =
        !existingPartnerRsvp ||
        existingPartnerRsvp.partnerRsvpByUserId === userId ||
        existingPartnerRsvp.status === body.status;

      if (canWriteMirroredRsvp) {
        includedPartnerInRsvp = true;
        await db
          .insert(eventRsvps)
          .values({
            userId: partnerUserId,
            eventId,
            status: body.status,
            notGoingReason,
            partnerRsvpByUserId: userId,
          })
          .onConflictDoUpdate({
            target: [eventRsvps.userId, eventRsvps.eventId],
            set: {
              status: body.status,
              notGoingReason,
              partnerRsvpByUserId: userId,
              updatedAt: new Date(),
            },
          });
      }
    } else {
      await db
        .delete(eventRsvps)
        .where(
          and(
            eq(eventRsvps.userId, partnerUserId),
            eq(eventRsvps.eventId, eventId),
            eq(eventRsvps.partnerRsvpByUserId, userId)
          )
        );
    }
  }

  const activityType =
    body.status === "going"
      ? "rsvp_going"
      : body.status === "interested"
        ? "rsvp_interested"
        : "rsvp_not_going";

  if (eventHasEnded) {
    await clearRsvpActivity({
      actorUserId: userId,
      entityId: eventId,
    });
  } else {
    await upsertRsvpActivity({
      actorUserId: userId,
      entityId: eventId,
      type: activityType,
      metadata: {
        status: body.status,
        includePartner: includedPartnerInRsvp,
        reason: notGoingReason,
        notifyFriends: shouldNotifyFriends,
      },
    });
  }

  if (
    shouldNotifyFriends &&
    (body.status === "going" || body.status === "interested") &&
    existingUserRsvp?.status !== body.status
  ) {
    await notifyFriendsOfRsvp(
      {
        actorUserId: userId,
        eventId,
        status: body.status,
        partnerUserId: includedPartnerInRsvp ? partnerUserId : null,
      },
      db
    );
  }

  return NextResponse.json({
    status: rsvp?.status ?? body.status,
    notGoingReason: rsvp?.notGoingReason ?? notGoingReason,
    includePartner: includedPartnerInRsvp,
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

  const partnerRelationship = await db.query.userPartners.findFirst({
    where: and(
      eq(userPartners.status, "accepted"),
      or(eq(userPartners.requesterId, userId), eq(userPartners.recipientId, userId))
    ),
  });

  const partnerUserId = partnerRelationship
    ? partnerRelationship.requesterId === userId
      ? partnerRelationship.recipientId
      : partnerRelationship.requesterId
    : null;

  if (partnerUserId) {
    await db
      .delete(eventRsvps)
      .where(
        and(
          eq(eventRsvps.userId, partnerUserId),
          eq(eventRsvps.eventId, eventId),
          eq(eventRsvps.partnerRsvpByUserId, userId)
        )
      );
  }

  await clearRsvpActivity({
    actorUserId: userId,
    entityId: eventId,
  });

  return NextResponse.json({
    status: null,
    notGoingReason: null,
    includePartner: false,
    updatedAt: null,
  });
}
