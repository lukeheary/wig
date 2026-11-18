import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { allowsPushNotification } from "@/lib/notification-preferences";
import { db } from "@/server/db";
import {
  eventReminderDeliveries,
  eventRsvps,
  events,
  places,
  userNotificationPreferences,
  users,
} from "@/server/db/schema";
import { eventSourceVisibilityCondition } from "./event-source-visibility";
import {
  eventReminderContent,
  isEventReminderDue,
} from "./event-reminder-content";
import { sendPushNotificationToUsers } from "./push-notifications";

type Database = typeof db;

export async function sendDueEventReminders(
  database: Database = db,
  now = new Date(),
  sendPush = sendPushNotificationToUsers
) {
  const startedAt = Date.now();
  const upcoming = await database.query.events.findMany({
    where: and(
      eq(events.status, "active"),
      gt(events.startAt, now),
      lt(events.startAt, new Date(now.getTime() + 48 * 60 * 60_000))
    ),
    columns: {
      id: true,
      title: true,
      startAt: true,
      timeZone: true,
      state: true,
    },
  });
  const dueIds = upcoming
    .filter((event) => isEventReminderDue(event, now))
    .map((event) => event.id);
  if (!dueIds.length) return { sent: 0, attempted: 0, failed: 0 };

  const recipientQuery = () =>
    database
      .select({
        userId: eventRsvps.userId,
        eventId: events.id,
        publicId: events.publicId,
        status: eventRsvps.status,
        title: events.title,
        startAt: events.startAt,
        timeZone: events.timeZone,
        state: events.state,
        placeName: places.name,
        preferences: userNotificationPreferences.preferences,
      })
      .from(eventRsvps)
      .innerJoin(events, eq(events.id, eventRsvps.eventId))
      .innerJoin(users, eq(users.id, eventRsvps.userId))
      .leftJoin(places, eq(places.id, events.venueId))
      .leftJoin(
        userNotificationPreferences,
        eq(userNotificationPreferences.userId, eventRsvps.userId)
      );
  const eligible = and(
    inArray(events.id, dueIds),
    eq(events.status, "active"),
    gt(events.startAt, now),
    inArray(eventRsvps.status, ["going", "interested"]),
    eq(users.moderationStatus, "active"),
    eventSourceVisibilityCondition(events.source, eventRsvps.userId),
    sql`exists (select 1 from user_push_tokens t where t.user_id = ${eventRsvps.userId} and t.revoked_at is null)`
  );
  const recipients = await recipientQuery().where(
    and(
      eligible,
      sql`not exists (
    select 1 from event_reminder_deliveries d
    where d.user_id = ${eventRsvps.userId} and d.event_id = ${events.id}
      and (d.sent_at is not null or d.claimed_at > ${new Date(now.getTime() - 15 * 60_000)})
  )`
    )
  );
  let sent = 0;
  let attempted = 0;
  let failed = 0;
  // Bound concurrent APNs requests and stop before the function timeout. Later
  // cron runs resume undelivered recipients within the one-hour grace window.
  for (
    let index = 0;
    index < recipients.length && Date.now() - startedAt < 40_000;
    index += 5
  ) {
    const results = await Promise.allSettled(
      recipients.slice(index, index + 5).map(async (recipient) => {
        const data = {
          type: "event_reminder",
          status: recipient.status,
          entityId: recipient.eventId,
          actionUrl: `/event/${recipient.publicId}`,
        };
        if (!allowsPushNotification(recipient.preferences, data)) return;
        const claimToken = randomUUID();
        const [claim] = await database
          .insert(eventReminderDeliveries)
          .values({
            userId: recipient.userId,
            eventId: recipient.eventId,
            claimToken,
            claimedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              eventReminderDeliveries.userId,
              eventReminderDeliveries.eventId,
            ],
            set: { claimToken, claimedAt: now },
            setWhere: and(
              isNull(eventReminderDeliveries.sentAt),
              lt(
                eventReminderDeliveries.claimedAt,
                new Date(now.getTime() - 15 * 60_000)
              )
            ),
          })
          .returning({ claimToken: eventReminderDeliveries.claimToken });
        if (!claim) return;
        const ownedClaim = and(
          eq(eventReminderDeliveries.userId, recipient.userId),
          eq(eventReminderDeliveries.eventId, recipient.eventId),
          eq(eventReminderDeliveries.claimToken, claimToken)
        );
        let delivered = false;
        try {
          // Recheck after acquiring the claim: a removed/changed RSVP, cancellation,
          // reschedule, source visibility change, or disabled setting wins over the snapshot.
          const [current] = await recipientQuery().where(
            and(
              eligible,
              eq(eventRsvps.userId, recipient.userId),
              eq(events.id, recipient.eventId)
            )
          );
          if (
            !current ||
            (current.status !== "going" && current.status !== "interested") ||
            !isEventReminderDue(current, now)
          )
            return;
          const payloadData = { ...data, status: current.status };
          if (!allowsPushNotification(current.preferences, payloadData)) return;
          attempted++;
          const result = await sendPush(
            [current.userId],
            {
              ...eventReminderContent(current, current.status, now),
              data: payloadData,
              collapseId: `reminder-${current.eventId}`,
              expiresAt: current.startAt,
            },
            database
          );
          if (result.successCount > 0) {
            delivered = true;
            await database
              .update(eventReminderDeliveries)
              .set({ sentAt: now })
              .where(ownedClaim);
            sent++;
          }
        } finally {
          // Only retry when APNs accepted no deliveries. A process crash leaves a
          // recoverable 15-minute lease; the stable APNs collapse ID coalesces retries.
          if (!delivered)
            await database.delete(eventReminderDeliveries).where(ownedClaim);
        }
      })
    );
    for (const result of results) {
      if (result.status === "rejected") {
        failed++;
        console.error("Event reminder delivery failed", result.reason);
      }
    }
  }
  return { sent, attempted, failed };
}
