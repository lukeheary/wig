import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import {
  events,
  notifications,
  notificationEntityTypeEnum,
  notificationTypeEnum,
  userFriends,
  userFriendsMutedNotifications,
  users,
} from "../db/schema";
import { sendPushNotificationToUsers } from "./push-notifications";
import { formatFriendRsvpBody } from "./notification-content";

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
    partnerUserId,
  }: {
    actorUserId: string;
    eventId: string;
    status: "going" | "interested";
    partnerUserId?: string | null;
  },
  database: DatabaseClient = db
) {
  const [actor, partner, event, friendConnections] = await Promise.all([
    database.query.users.findFirst({
      where: eq(users.id, actorUserId),
      columns: {
        firstName: true,
        lastName: true,
        username: true,
      },
    }),
    partnerUserId
      ? database.query.users.findFirst({
          where: eq(users.id, partnerUserId),
          columns: {
            firstName: true,
            lastName: true,
            username: true,
          },
        })
      : Promise.resolve(null),
    database.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: {
        id: true,
        publicId: true,
        title: true,
        startAt: true,
        timeZone: true,
        state: true,
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

  const mutedRecipients =
    await database.query.userFriendsMutedNotifications.findMany({
      where: and(
        eq(userFriendsMutedNotifications.friendUserId, actorUserId),
        inArray(userFriendsMutedNotifications.userId, recipientIds)
      ),
      columns: {
        userId: true,
      },
    });
  const mutedRecipientIds = new Set(mutedRecipients.map((mute) => mute.userId));
  const pushRecipientIds = recipientIds.filter(
    (userId) => !mutedRecipientIds.has(userId)
  );

  const actorName =
    [actor?.firstName, actor?.lastName].filter(Boolean).join(" ").trim() ||
    actor?.username ||
    "Your friend";
  const partnerName =
    [partner?.firstName, partner?.lastName].filter(Boolean).join(" ").trim() ||
    partner?.username ||
    null;
  const includesPartner = Boolean(partnerName);
  const title = includesPartner ? `${actorName} & ${partnerName}` : actorName;
  const body = formatFriendRsvpBody({
    eventTitle: event.title,
    eventStartAt: event.startAt,
    eventTimeZone: event.timeZone,
    eventState: event.state,
    status,
    includesPartner,
  });
  const actionUrl = `/event/${event.publicId}`;

  const createdNotifications = await createNotifications(
    recipientIds.map((userId) => ({
      userId,
      actorUserId,
      type: "event_update",
      entityType: "event",
      entityId: event.id,
      title,
      body,
      actionUrl,
      metadata: {
        source: "friend_rsvp",
        status,
        eventId: event.id,
        eventTitle: event.title,
        partnerUserId: partnerUserId ?? null,
        partnerName,
      },
    })),
    database
  );

  await sendPushNotificationToUsers(
    pushRecipientIds,
    {
      title,
      body,
      data: {
        type: "event_update",
        entityId: event.id,
        actionUrl,
        source: "friend_rsvp",
        status,
        partnerUserId: partnerUserId ?? null,
        partnerName,
      },
    },
    database
  );

  return createdNotifications;
}
