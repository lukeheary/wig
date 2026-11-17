import { z } from "zod";

export const notificationPreferencesSchema = z
  .object({
    pushEnabled: z.boolean(),
    friendsGoing: z.boolean(),
    friendsInterested: z.boolean(),
    friendRequests: z.boolean(),
    friendRequestAccepted: z.boolean(),
    partnerRequests: z.boolean(),
    partnerRequestAccepted: z.boolean(),
    partnerRsvps: z.boolean(),
    goingReminders: z.boolean(),
    interestedReminders: z.boolean(),
    eventChanges: z.boolean(),
    supportUpdates: z.boolean(),
  })
  .strict();

export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
export const defaultNotificationPreferences: NotificationPreferences = {
  pushEnabled: true,
  friendsGoing: true,
  friendsInterested: true,
  friendRequests: true,
  friendRequestAccepted: true,
  partnerRequests: true,
  partnerRequestAccepted: true,
  partnerRsvps: true,
  goingReminders: true,
  interestedReminders: true,
  eventChanges: true,
  supportUpdates: true,
};

export function resolveNotificationPreferences(
  saved: unknown
): NotificationPreferences {
  const result = { ...defaultNotificationPreferences };
  if (saved && typeof saved === "object") {
    for (const key of Object.keys(
      result
    ) as (keyof NotificationPreferences)[]) {
      const value = (saved as Record<string, unknown>)[key];
      if (typeof value === "boolean") result[key] = value;
    }
  }
  return result;
}

export function notificationPreferenceCategory(
  data?: Record<string, unknown>
): Exclude<keyof NotificationPreferences, "pushEnabled"> | null {
  switch (data?.type) {
    case "event_reminder":
      return data.status === "going" ? "goingReminders" : "interestedReminders";
    case "friend_request":
      return "friendRequests";
    case "friend_request_accepted":
      return "friendRequestAccepted";
    case "partner_request":
      return "partnerRequests";
    case "partner_request_accepted":
      return "partnerRequestAccepted";
    case "support_ticket_created":
    case "support_ticket_status_changed":
      return "supportUpdates";
    case "event_update":
      if (data.source === "partner_rsvp") return "partnerRsvps";
      if (data.source === "friend_rsvp") {
        if (data.status === "going") return "friendsGoing";
        if (data.status === "interested") return "friendsInterested";
        return null;
      }
      return "eventChanges";
    default:
      return null;
  }
}

export function allowsPushNotification(
  saved: unknown,
  data?: Record<string, unknown>
) {
  const preferences = resolveNotificationPreferences(saved);
  if (!preferences.pushEnabled) return false;
  const category = notificationPreferenceCategory(data);
  return category == null || preferences[category];
}
