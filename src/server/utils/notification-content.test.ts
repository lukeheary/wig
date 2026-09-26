import assert from "node:assert/strict";
import test from "node:test";
import {
  formatFriendRsvpBody,
  formatNotificationEventDate,
} from "./notification-content";

const lateEveningEvent = new Date("2026-09-26T02:00:00.000Z");

test("notification event dates use the event timezone across a UTC date boundary", () => {
  assert.equal(
    formatNotificationEventDate(lateEveningEvent, "America/New_York", "MA"),
    "Sep 25"
  );
});

test("notification event dates fall back to the event state timezone", () => {
  assert.equal(
    formatNotificationEventDate(lateEveningEvent, null, "MA"),
    "Sep 25"
  );
});

test("friend RSVP notification bodies use the event-local date", () => {
  assert.equal(
    formatFriendRsvpBody({
      eventTitle: "Friday Feels",
      eventStartAt: lateEveningEvent,
      eventTimeZone: "America/New_York",
      eventState: "MA",
      status: "going",
      includesPartner: false,
    }),
    "Is going to Friday Feels on Sep 25"
  );
});
