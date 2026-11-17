# Event reminders

The iOS Profile → ⋯ → Notification Settings page has two independent account preferences:

- `goingReminders`: enabled by default.
- `interestedReminders`: disabled by default.

The master push switch also applies. The settings API merges partial changes, so existing saved accounts receive these defaults without a backfill. The iOS decoder supports older API responses while deploying. Friend RSVP alerts have separate switches.

## Timing and copy

Use the event's time zone, falling back to its state and then UTC. Invalid stored zone identifiers fall back to state rather than failing the whole job.

- Event starting at 5 PM or later: 1 PM on the event date.
- Event starting before 5 PM: 8 PM on the preceding local calendar date.

Calendar arithmetic preserves these times over daylight-saving changes. The date wording uses the existing activity formatter (`tonight`, `tomorrow`, etc.). A Going reminder says “Reminder: [event]” / “You’re going tonight at [time] at [venue].” An Interested reminder says “Still interested in [event]?” / “It’s happening tonight at [time] at [venue].” Venue text is omitted when unavailable. Both carry `/event/[publicId]` and open the event through the app's existing push routing.

These are push-only reminders; they do not create friend activity or add reminder rows to Activity.

## Delivery and rollout

1. Apply migrations `0077_notification_preferences` and `0078_event_reminder_deliveries` before deploying the sender. No production migration has been run by this change.
2. Configure `CRON_SECRET` and the existing APNs credentials in the production deployment. Missing cron authorization always returns 401. Existing push-token registration and permission handling are reused.
3. Deploy the backend with `vercel.json` and the updated iOS app. `/api/cron/event-reminders` runs every 15 minutes; the 1 PM/8 PM run delivers reminders, with a one-hour catch-up window for delays or failures. This frequency requires a Vercel plan supporting subdaily cron jobs (or an external authenticated scheduler calling the same endpoint). See [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

The worker loads current upcoming active events and Going/Interested RSVPs; it excludes non-active accounts, hidden event sources, and accounts without active push tokens. It rechecks status, time, RSVP, source visibility, and preferences after claiming a delivery. Removed RSVPs and canceled/postponed/draft events are skipped.

A primary key on `(user_id, event_id)` prevents repeated reminders even if the RSVP status changes or multiple jobs run. Unfinished claims expire after 15 minutes. If APNs accepts no deliveries, the claim is released for retry within the catch-up window. If at least one device accepts the notification, the reminder is marked sent; delivery to other failed devices is not retried. This favors avoiding duplicate alerts. A crash between APNs acceptance and the sent write can still cause a retry; its stable APNs collapse identifier coalesces notifications. APNs expiration is set to the event start so offline devices do not receive stale reminders afterward. See [Apple's request headers](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns).

APNs acceptance is not confirmation that a person saw the notification. No live APNs delivery or production database writes are performed by the automated tests.
