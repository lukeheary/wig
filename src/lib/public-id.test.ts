import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_EVENT_PATH_PATTERN } from "./public-id";

test("only public-ID event detail paths bypass the page sign-in guard", () => {
  const id = "4V6biUvjuN4sJs0ZeSUH";
  assert.equal(PUBLIC_EVENT_PATH_PATTERN.test(`/event/${id}`), true);
  assert.equal(PUBLIC_EVENT_PATH_PATTERN.test(`/event/${id}/`), true);
  for (const path of ["/event/new", `/event/${id}/edit`, `/event/${id}/friends`, "/profile", "/admin", "/event/not-an-id", `/event/${id}extra`]) {
    assert.equal(PUBLIC_EVENT_PATH_PATTERN.test(path), false, path);
  }
});
