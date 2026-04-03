import { db } from "../db";
import { userActivity, activityEntityTypeEnum, activityTypeEnum } from "../db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

type ActivityType = (typeof activityTypeEnum.enumValues)[number];
type ActivityEntityType = (typeof activityEntityTypeEnum.enumValues)[number];
const RSVP_ACTIVITY_TYPES: ActivityType[] = [
    "rsvp_going",
    "rsvp_interested",
    "rsvp_not_going",
];

interface LogActivityParams {
    actorUserId: string;
    type: ActivityType;
    entityType: ActivityEntityType;
    entityId: string;
    metadata?: Record<string, any>;
}

export async function logActivity({
    actorUserId,
    type,
    entityType,
    entityId,
    metadata,
}: LogActivityParams) {
    try {
        await db.insert(userActivity).values({
            actorUserId,
            type,
            entityType,
            entityId,
            metadata,
            updatedAt: new Date(),
        });
    } catch (error) {
        console.error("Failed to log activity:", error);
        // We don't want to throw here because logging shouldn't break the main action
    }
}

interface UpdateLatestActivityMetadataParams {
    actorUserId: string;
    type: ActivityType;
    entityType: ActivityEntityType;
    entityId: string;
    metadata?: Record<string, any>;
}

export async function updateLatestActivityMetadata({
    actorUserId,
    type,
    entityType,
    entityId,
    metadata,
}: UpdateLatestActivityMetadataParams) {
    try {
        const existingActivity = await db.query.userActivity.findFirst({
            where: and(
                eq(userActivity.actorUserId, actorUserId),
                eq(userActivity.type, type),
                eq(userActivity.entityType, entityType),
                eq(userActivity.entityId, entityId)
            ),
            orderBy: [desc(userActivity.updatedAt), desc(userActivity.createdAt)],
            columns: {
                id: true,
            },
        });

        if (!existingActivity) {
            return false;
        }

        await db
            .update(userActivity)
            .set({
                metadata,
                updatedAt: new Date(),
            })
            .where(eq(userActivity.id, existingActivity.id));

        return true;
    } catch (error) {
        console.error("Failed to update latest activity metadata:", error);
        return false;
    }
}

interface UpsertRsvpActivityParams {
    actorUserId: string;
    entityId: string;
    type: Extract<ActivityType, "rsvp_going" | "rsvp_interested" | "rsvp_not_going">;
    metadata?: Record<string, any>;
}

export async function upsertRsvpActivity({
    actorUserId,
    entityId,
    type,
    metadata,
}: UpsertRsvpActivityParams) {
    try {
        const existingActivities = await db.query.userActivity.findMany({
            where: and(
                eq(userActivity.actorUserId, actorUserId),
                eq(userActivity.entityType, "event"),
                eq(userActivity.entityId, entityId),
                inArray(userActivity.type, RSVP_ACTIVITY_TYPES)
            ),
            orderBy: [desc(userActivity.updatedAt), desc(userActivity.createdAt)],
            columns: {
                id: true,
            },
        });

        const now = new Date();
        const [existingActivity, ...staleActivities] = existingActivities;

        if (!existingActivity) {
            await db.insert(userActivity).values({
                actorUserId,
                type,
                entityType: "event",
                entityId,
                metadata,
                updatedAt: now,
            });
            return;
        }

        await db
            .update(userActivity)
            .set({
                type,
                metadata,
                updatedAt: now,
            })
            .where(eq(userActivity.id, existingActivity.id));

        if (staleActivities.length > 0) {
            await db
                .delete(userActivity)
                .where(
                    inArray(
                        userActivity.id,
                        staleActivities.map((activity) => activity.id)
                    )
                );
        }
    } catch (error) {
        console.error("Failed to upsert RSVP activity:", error);
  }
}

export async function clearRsvpActivity({
  actorUserId,
  entityId,
}: {
  actorUserId: string;
  entityId: string;
}) {
  try {
    await db
      .delete(userActivity)
      .where(
        and(
          eq(userActivity.actorUserId, actorUserId),
          eq(userActivity.entityType, "event"),
          eq(userActivity.entityId, entityId),
          inArray(userActivity.type, RSVP_ACTIVITY_TYPES)
        )
      );
  } catch (error) {
    console.error("Failed to clear RSVP activity:", error);
  }
}
