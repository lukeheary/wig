import { db } from "../db";
import { userActivity, activityEntityTypeEnum, activityTypeEnum } from "../db/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

type ActivityType = (typeof activityTypeEnum.enumValues)[number];
type ActivityEntityType = (typeof activityEntityTypeEnum.enumValues)[number];

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
            orderBy: [desc(userActivity.createdAt)],
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
            })
            .where(eq(userActivity.id, existingActivity.id));

        return true;
    } catch (error) {
        console.error("Failed to update latest activity metadata:", error);
        return false;
    }
}
