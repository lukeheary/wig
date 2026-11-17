import assert from "node:assert/strict";
import test from "node:test";
import {
  allowsPushNotification,
  defaultNotificationPreferences,
  notificationPreferenceCategory,
  notificationPreferencesSchema,
  resolveNotificationPreferences,
} from "./notification-preferences";

const categories = [
  [
    { type: "event_update", source: "friend_rsvp", status: "going" },
    "friendsGoing",
  ],
  [
    { type: "event_update", source: "friend_rsvp", status: "interested" },
    "friendsInterested",
  ],
  [{ type: "friend_request" }, "friendRequests"],
  [{ type: "friend_request_accepted" }, "friendRequestAccepted"],
  [{ type: "partner_request" }, "partnerRequests"],
  [{ type: "partner_request_accepted" }, "partnerRequestAccepted"],
  [
    { type: "event_update", source: "partner_rsvp", status: "going" },
    "partnerRsvps",
  ],
  [
    { type: "event_update", source: "partner_rsvp", status: "interested" },
    "partnerRsvps",
  ],
  [{ type: "event_update", eventActivityType: "cancelled" }, "eventChanges"],
  [{ type: "support_ticket_status_changed" }, "supportUpdates"],
] as const;

test("existing accounts preserve defaults without a saved row", () => {
  assert.deepEqual(
    resolveNotificationPreferences(undefined),
    defaultNotificationPreferences
  );
  for (const [data] of categories)
    assert.equal(allowsPushNotification(undefined, data), true);
});

for (const [data, category] of categories) {
  test(`push preferences classify ${JSON.stringify(data)} as ${category}`, () => {
    assert.equal(notificationPreferenceCategory(data), category);
    assert.equal(allowsPushNotification({ [category]: false }, data), false);
    assert.equal(allowsPushNotification({ [category]: true }, data), true);
    assert.equal(
      allowsPushNotification({ pushEnabled: false, [category]: true }, data),
      false
    );
  });
}

test("disabling Going leaves Interested and request alerts enabled", () => {
  const preferences = { friendsGoing: false };
  assert.equal(allowsPushNotification(preferences, categories[0][0]), false);
  assert.equal(allowsPushNotification(preferences, categories[1][0]), true);
  assert.equal(
    allowsPushNotification(preferences, { type: "friend_request" }),
    true
  );
});

test("master switch preserves category choices while stopping every alert type", () => {
  const saved = {
    pushEnabled: false,
    friendsGoing: false,
    friendsInterested: true,
  };
  const resolved = resolveNotificationPreferences(saved);
  assert.equal(resolved.friendsGoing, false);
  assert.equal(resolved.friendsInterested, true);
  assert.equal(allowsPushNotification(saved, { type: "future_alert" }), false);
  assert.equal(
    allowsPushNotification({ ...saved, pushEnabled: true }, categories[0][0]),
    false
  );
  assert.equal(
    allowsPushNotification({ ...saved, pushEnabled: true }, categories[1][0]),
    true
  );
});

test("partial updates reject unknown preferences and non-boolean values", () => {
  const patch = notificationPreferencesSchema.partial();
  assert.equal(patch.safeParse({ friendsGoing: false }).success, true);
  for (const input of [
    { userId: "another-user" },
    { pushEnabled: "false" },
    { friendsGoing: null },
  ]) {
    assert.equal(patch.safeParse(input).success, false);
  }
});

test("stored partial and malformed data cannot erase default choices", () => {
  const resolved = resolveNotificationPreferences({
    friendsGoing: false,
    friendsInterested: "false",
  });
  assert.equal(resolved.friendsGoing, false);
  assert.equal(resolved.friendsInterested, true);
  assert.equal(resolved.friendRequests, true);
});

for (const [status, key, enabled] of [
  ["going", "goingReminders", true],
  ["interested", "interestedReminders", true],
] as const) {
  test(`${status} reminders have independent saved controls and defaults`, () => {
    const data = { type: "event_reminder", status };
    assert.equal(notificationPreferenceCategory(data), key);
    assert.equal(allowsPushNotification(undefined, data), enabled);
    assert.equal(allowsPushNotification({ [key]: true }, data), true);
    assert.equal(allowsPushNotification({ [key]: false }, data), false);
    assert.equal(
      allowsPushNotification({ pushEnabled: false, [key]: true }, data),
      false
    );
    assert.equal(
      notificationPreferencesSchema.partial().safeParse({ [key]: false })
        .success,
      true
    );
  });
}
