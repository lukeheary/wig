import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  notifications,
  notificationEntityTypeEnum,
  notificationTypeEnum,
} from "../db/schema";

type NotificationType = (typeof notificationTypeEnum.enumValues)[number];
type NotificationEntityType =
  (typeof notificationEntityTypeEnum.enumValues)[number];

export interface NotificationInsert {
  userId: string;
  actorUserId?: string | null;
  type: NotificationType;
  entityType: NotificationEntityType;
  entityId: string;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

type DatabaseClient = typeof db;

export async function createNotification(
  notification: NotificationInsert,
  database: DatabaseClient = db
) {
  const [created] = await database
    .insert(notifications)
    .values({
      userId: notification.userId,
      actorUserId: notification.actorUserId ?? null,
      type: notification.type,
      entityType: notification.entityType,
      entityId: notification.entityId,
      title: notification.title,
      body: notification.body ?? null,
      actionUrl: notification.actionUrl ?? null,
      metadata: notification.metadata ?? null,
    })
    .returning();

  return created;
}

export async function createNotifications(
  notificationRows: NotificationInsert[],
  database: DatabaseClient = db
) {
  if (notificationRows.length === 0) {
    return [];
  }

  return database
    .insert(notifications)
    .values(
      notificationRows.map((notification) => ({
        userId: notification.userId,
        actorUserId: notification.actorUserId ?? null,
        type: notification.type,
        entityType: notification.entityType,
        entityId: notification.entityId,
        title: notification.title,
        body: notification.body ?? null,
        actionUrl: notification.actionUrl ?? null,
        metadata: notification.metadata ?? null,
      }))
    )
    .returning();
}

export async function deleteNotificationsForEntity(
  {
    userId,
    entityType,
    entityIds,
  }: {
    userId?: string;
    entityType: NotificationEntityType;
    entityIds: string[];
  },
  database: DatabaseClient = db
) {
  if (entityIds.length === 0) {
    return [];
  }

  const conditions = [
    eq(notifications.entityType, entityType),
    inArray(notifications.entityId, entityIds),
  ];

  if (userId) {
    conditions.push(eq(notifications.userId, userId));
  }

  return database
    .delete(notifications)
    .where(and(...conditions))
    .returning();
}
