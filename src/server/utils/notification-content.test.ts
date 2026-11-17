import assert from "node:assert/strict";
import test from "node:test";
import {
  formatFriendRsvpBody,
  formatNotificationEventDate,
  formatNotificationEventDatePhrase,
  formatNotificationEventDetails,
} from "./notification-content";

import dateCases from "./fixtures/activity-event-dates.json";

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
      now: new Date("2026-09-01T12:00:00Z"),
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

for (const status of ["going", "interested"] as const) {
  for (const includesPartner of [false, true]) {
    test(`RSVP ${status} with partner=${includesPartner} includes the venue before the local date`, () => {
      assert.equal(
        formatFriendRsvpBody({
          now: new Date("2026-09-01T12:00:00Z"),
          eventTitle: "Friday Feels",
          eventPlaceName: "The Grand",
          eventStartAt: lateEveningEvent,
          eventTimeZone: "America/New_York",
          status,
          includesPartner,
        }),
        `${includesPartner ? "Are" : "Is"} ${status === "going" ? "going to" : "interested in"} Friday Feels at The Grand on Sep 25`
      );
    });
  }
}

test("event notification details handle missing places and dates", () => {
  for (const eventPlaceName of [null, undefined, "   "]) {
    assert.equal(
      formatNotificationEventDetails({
        now: new Date("2026-09-01T12:00:00Z"),
        eventTitle: "Friday Feels",
        eventPlaceName,
        eventStartAt: null,
      }),
      "Friday Feels"
    );
  }
  assert.equal(
    formatNotificationEventDetails({
      now: new Date("2026-09-01T12:00:00Z"),
      eventTitle: "Friday Feels",
      eventPlaceName: "The Grand",
      eventStartAt: null,
    }),
    "Friday Feels at The Grand"
  );
});

for (const fixture of dateCases) {
  test(`dynamic event date: ${fixture.name}`, () => {
    const startAt = new Date(fixture.startAt);
    const now = new Date(fixture.now);
    assert.equal(
      formatNotificationEventDatePhrase(
        startAt,
        fixture.timeZone,
        fixture.state,
        now
      ),
      fixture.expected
    );
    for (const status of ["going", "interested"] as const) {
      for (const includesPartner of [false, true]) {
        assert.equal(
          formatFriendRsvpBody({
            eventTitle: "Friday Feels",
            eventPlaceName: "The Grand",
            eventStartAt: startAt,
            eventTimeZone: fixture.timeZone,
            eventState: fixture.state,
            status,
            includesPartner,
            now,
          }),
          `${includesPartner ? "Are" : "Is"} ${status === "going" ? "going to" : "interested in"} Friday Feels at The Grand ${fixture.expected}`
        );
      }
    }
  });
}
