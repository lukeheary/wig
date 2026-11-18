import assert from "node:assert/strict";
import test from "node:test";
import {
  eventReminderContent,
  eventReminderScheduledAt,
  isEventReminderDue,
  type ReminderEvent,
} from "./event-reminder-content";

const event = (
  start: string,
  timeZone = "America/New_York"
): ReminderEvent => ({
  title: "Jazz at the Park",
  startAt: new Date(start),
  timeZone,
  state: "NY",
  placeName: "Riverside Park",
});

for (const [label, start, zone, expected] of [
  [
    "evening threshold",
    "2026-11-17T22:00:00Z",
    "America/New_York",
    "2026-11-17T18:00:00Z",
  ],
  [
    "before evening threshold",
    "2026-11-17T21:59:00Z",
    "America/New_York",
    "2026-11-17T01:00:00Z",
  ],
  [
    "morning",
    "2026-11-17T14:00:00Z",
    "America/New_York",
    "2026-11-17T01:00:00Z",
  ],
  [
    "west coast date",
    "2026-11-18T03:00:00Z",
    "America/Los_Angeles",
    "2026-11-17T21:00:00Z",
  ],
  [
    "spring DST",
    "2026-03-08T14:00:00Z",
    "America/New_York",
    "2026-03-08T01:00:00Z",
  ],
  [
    "fall DST",
    "2026-11-01T15:00:00Z",
    "America/New_York",
    "2026-11-01T00:00:00Z",
  ],
  [
    "year boundary",
    "2027-01-01T14:00:00Z",
    "America/New_York",
    "2027-01-01T01:00:00Z",
  ],
  [
    "half-hour offset",
    "2026-11-17T13:30:00Z",
    "Asia/Kolkata",
    "2026-11-17T07:30:00Z",
  ],
] as const) {
  test(`reminder schedule handles ${label}`, () => {
    assert.equal(
      eventReminderScheduledAt(event(start, zone)).toISOString(),
      new Date(expected).toISOString()
    );
  });
}

test("uses state fallback for missing/invalid timezone without crashing", () => {
  for (const zone of [null, "invalid/zone"]) {
    assert.equal(
      eventReminderScheduledAt({
        ...event("2026-11-17T22:00:00Z"),
        timeZone: zone,
      }).toISOString(),
      "2026-11-17T18:00:00.000Z"
    );
  }
});

test("reminder only becomes due at scheduled time and expires after an hour", () => {
  const e = event("2026-11-17T22:00:00Z");
  for (const [time, due] of [
    ["17:59:59", false],
    ["18:00:00", true],
    ["18:59:59", true],
    ["19:00:00", false],
    ["22:00:00", false],
  ] as const) {
    assert.equal(isEventReminderDue(e, new Date(`2026-11-17T${time}Z`)), due);
  }
});

test("approved copy distinguishes Going and Interested with tonight and tomorrow", () => {
  const tonight = event("2026-11-18T00:00:00Z");
  const afternoon = new Date("2026-11-17T18:00:00Z");
  assert.deepEqual(eventReminderContent(tonight, "going", afternoon), {
    title: "Reminder: Jazz at the Park",
    body: "You’re going tonight at 7 PM at Riverside Park.",
  });
  assert.deepEqual(eventReminderContent(tonight, "interested", afternoon), {
    title: "Still interested in Jazz at the Park?",
    body: "It’s happening tonight at 7 PM at Riverside Park.",
  });
  const tomorrow = event("2026-11-18T14:30:00Z");
  assert.equal(
    eventReminderContent(
      { ...tomorrow, placeName: null },
      "going",
      new Date("2026-11-18T01:00:00Z")
    ).body,
    "You’re going tomorrow at 9:30 AM."
  );
});
