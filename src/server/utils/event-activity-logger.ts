import { db } from "../db";
import {
  eventActivity,
  eventActivityTypeEnum,
  eventRsvps,
  events,
  notifications,
  users,
} from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";

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

    await db.insert(notifications).values(
      recipientIds.map((userId) => ({
        userId,
        actorUserId,
        type: "event_update" as const,
        entityType: "event" as const,
        entityId: event.id,
        title: "Event update",
        body: `${actorName} ${actionTextByType[type]} ${event.title}`,
        actionUrl: `/event/${event.id}`,
        metadata: {
          eventActivityId: activity.id,
          eventId: event.id,
          eventTitle: event.title,
          eventActivityType: type,
          ...metadata,
        },
      }))
    );
  } catch (error) {
    console.error("Failed to log event activity:", error);
    // Logging should never break the primary mutation flow.
  }
}
