import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_MODERATION_REJECTION_MESSAGE,
  ContentModerationError,
  assertTextContentAllowed,
  moderateTextFields,
} from "./content-moderation";

test("allows ordinary nightlife content", () => {
  assert.deepEqual(
    moderateTextFields([
      { field: "title", value: "Friday Night at The Lantern" },
      { field: "description", value: "DJs, dancing, and late-night food." },
    ]),
    { allowed: true }
  );
});

test("blocks direct violent threats after normalization", () => {
  const result = moderateTextFields([
    { field: "comment", value: "I'M   GOING TO SH00T YOU" },
  ]);
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.category, "violent_threat");
});

test("blocks sexual exploitation phrases", () => {
  const result = moderateTextFields([
    { field: "description", value: "send underage nudes" },
  ]);
  assert.equal(result.allowed, false);
});

test("reports a neutral public error", () => {
  assert.throws(
    () =>
      assertTextContentAllowed([
        { field: "title", value: "double your crypto" },
      ]),
    (error) =>
      error instanceof ContentModerationError &&
      error.message === CONTENT_MODERATION_REJECTION_MESSAGE
  );
});
