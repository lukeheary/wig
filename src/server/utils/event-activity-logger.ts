import { isProfileHidden } from "./profile-visibility";
import { db } from "../db";
import {
  eventActivity,
  eventActivityTypeEnum,
  eventRsvps,
  events,
  users,
} from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { createNotifications } from "./notifications";

type EventActivityType = (typeof eventActivityTypeEnum.enumValues)[number];

interface LogEventActivityParams {
  actorUserId: string;
  eventId: string;
  type: EventActivityType;
  metadata?: Record<string, any>;
}

export async function logEventActivity({
  actorUserId,
  eventId,
  type,
  metadata,
}: LogEventActivityParams) {
  if (await isProfileHidden(actorUserId)) return;
  try {
    const [activity] = await db
      .insert(eventActivity)
      .values({
        actorUserId,
        eventId,
        type,
        metadata,
      })
      .returning();

    const [event, actor, subscribers] = await Promise.all([
      db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
          id: true,
          publicId: true,
          title: true,
        },
      }),
      db.query.users.findFirst({
        where: eq(users.id, actorUserId),
        columns: {
          firstName: true,
          lastName: true,
          username: true,
        },
      }),
      db.query.eventRsvps.findMany({
        where: and(
          eq(eventRsvps.eventId, eventId),
          inArray(eventRsvps.status, ["going", "interested"])
        ),
        columns: {
          userId: true,
        },
      }),
    ]);

    const recipientIds = [...new Set(subscribers.map((rsvp) => rsvp.userId))].filter(
      (userId) => userId !== actorUserId
    );

    if (!event || recipientIds.length === 0) {
      return;
    }

    const actorName =
      [actor?.firstName, actor?.lastName].filter(Boolean).join(" ").trim() ||
      actor?.username ||
      "Someone";

    const actionTextByType: Record<EventActivityType, string> = {
      created: "created",
      updated: "updated",
      cancelled: "cancelled",
      postponed: "postponed",
      rescheduled: "rescheduled",
      restored: "restored",
    };

    await createNotifications(
      recipientIds.map((userId) => ({
        userId,
        actorUserId,
        type: "event_update",
        entityType: "event",
        entityId: event.id,
        title: "Event update",
        body: `${actorName} ${actionTextByType[type]} ${event.title}`,
        actionUrl: `/event/${event.publicId}`,
        metadata: {
          eventActivityId: activity.id,
          eventId: event.id,
          eventTitle: event.title,
          eventActivityType: type,
          ...metadata,
        },
      })),
      db
    );
  } catch (error) {
    console.error("Failed to log event activity:", error);
    // Logging should never break the primary mutation flow.
  }
}
