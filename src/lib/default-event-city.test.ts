import assert from "node:assert/strict";
import test from "node:test";
import { defaultEventCityUpdateSchema } from "./default-event-city";

const metroAreaId = "00000000-0000-4000-8000-000000000002";

test("accepts an existing onboarding metro choice", () => {
  assert.deepEqual(defaultEventCityUpdateSchema.parse({ metroAreaId }), {
    metroAreaId,
  });
});

test("requires a city choice rather than clearing the onboarding selection", () => {
  for (const input of [
    {},
    null,
    { metroAreaId: null },
    { metroAreaId: "Washington" },
  ]) {
    assert.equal(defaultEventCityUpdateSchema.safeParse(input).success, false);
  }
});

test("rejects changes to profile location and other accounts", () => {
  for (const input of [
    { metroAreaId, userId: "other-account" },
    { metroAreaId, city: "Boston" },
    { metroAreaId, state: "MA" },
  ]) {
    assert.equal(defaultEventCityUpdateSchema.safeParse(input).success, false);
  }
});
