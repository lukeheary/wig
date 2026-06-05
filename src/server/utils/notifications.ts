import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import {
  events,
  notifications,
  notificationEntityTypeEnum,
  notificationTypeEnum,
  userFriends,
  users,
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

export async function notifyFriendsOfRsvp(
  {
    actorUserId,
    eventId,
    status,
  }: {
    actorUserId: string;
    eventId: string;
    status: "going" | "interested";
  },
  database: DatabaseClient = db
) {
  const [actor, event, friendConnections] = await Promise.all([
    database.query.users.findFirst({
      where: eq(users.id, actorUserId),
      columns: {
        firstName: true,
        lastName: true,
        username: true,
      },
    }),
    database.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: {
        id: true,
        title: true,
      },
    }),
    database.query.userFriends.findMany({
      where: and(
        or(
          eq(userFriends.userId, actorUserId),
          eq(userFriends.friendUserId, actorUserId)
        ),
        eq(userFriends.status, "accepted")
      ),
      columns: {
        userId: true,
        friendUserId: true,
      },
    }),
  ]);

  if (!event || friendConnections.length === 0) {
    return [];
  }

  const recipientIds = [
    ...new Set(
      friendConnections
        .map((friendship) =>
          friendship.userId === actorUserId
            ? friendship.friendUserId
            : friendship.userId
        )
        .filter((userId) => userId !== actorUserId)
    ),
  ];

  if (recipientIds.length === 0) {
    return [];
  }

  const actorName =
    [actor?.firstName, actor?.lastName].filter(Boolean).join(" ").trim() ||
    actor?.username ||
    "Your friend";
  const verb = status === "going" ? "RSVP'd going to" : "is interested in";

  return createNotifications(
    recipientIds.map((userId) => ({
      userId,
      actorUserId,
      type: "event_update",
      entityType: "event",
      entityId: event.id,
      title: "Friend RSVP update",
      body: `${actorName} ${verb} ${event.title}`,
      actionUrl: `/event/${event.id}`,
      metadata: {
        source: "friend_rsvp",
        status,
        eventId: event.id,
        eventTitle: event.title,
      },
    })),
    database
  );
}
