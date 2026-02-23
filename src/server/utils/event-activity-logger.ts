import { db } from "../db";
import { eventActivity, eventActivityTypeEnum } from "../db/schema";

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
    await db.insert(eventActivity).values({
      actorUserId,
      eventId,
      type,
      metadata,
    });
  } catch (error) {
    console.error("Failed to log event activity:", error);
    // Logging should never break the primary mutation flow.
  }
}
