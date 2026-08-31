import assert from "node:assert/strict";
import test from "node:test";
import { promoUrlSchema } from "./promo-validation";
import { moderateTextFields } from "./content-moderation";

test("promo links accept web URLs and normalize clearing separately from omission", () => {
  assert.equal(
    promoUrlSchema.parse(" https://example.com/deal?code=VIP "),
    "https://example.com/deal?code=VIP"
  );
  assert.equal(
    promoUrlSchema.parse("http://example.com"),
    "http://example.com"
  );
  assert.equal(promoUrlSchema.parse("  "), null);
  assert.equal(promoUrlSchema.parse(null), null);
  assert.equal(promoUrlSchema.parse(undefined), undefined);
});

test("promo links reject malformed, executable, credential-bearing, and oversized URLs", () => {
  for (const value of [
    "not a link",
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/a",
    "https://user:password@example.com",
    "https://example.com/" + "a".repeat(2048),
    123,
  ]) {
    assert.equal(promoUrlSchema.safeParse(value).success, false, String(value));
  }
});

test("promo-specific moderation blocks swearing and common obfuscation", () => {
  for (const value of [
    "Free fucking drinks",
    "SH1T",
    "f.u.c.k",
    "f*ck",
    "sh*t",
    "fuuuck",
    "bitch",
    "asshole",
    "damn",
  ]) {
    const result = moderateTextFields([
      { field: "promo", value, rejectProfanity: true },
    ]);
    assert.equal(result.allowed, false, value);
    if (!result.allowed) assert.equal(result.category, "profanity");
  }
});

test("promo moderation allows ordinary offers and still blocks other prohibited content", () => {
  for (const value of [
    "Free with RSVP",
    "Cocktails in Scunthorpe",
    "Classic bass night",
    "",
  ]) {
    assert.equal(
      moderateTextFields([{ field: "promo", value, rejectProfanity: true }])
        .allowed,
      true
    );
  }
  assert.equal(
    moderateTextFields([
      { field: "promo", value: "double your crypto", rejectProfanity: true },
    ]).allowed,
    false
  );
});
