import assert from "node:assert/strict";
import crypto from "node:crypto";
import http2 from "node:http2";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

const keys = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.APNS_KEY_ID = "test-key";
process.env.APNS_TEAM_ID = "test-team";
process.env.APNS_PRIVATE_KEY = keys.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
process.env.APNS_BUNDLE_ID = "test.bundle";
const dispatcher = import("./push-notifications");

test("reminder APNs request signs a valid JWT and supplies expiration, collapse ID, and event link", async () => {
  const { sendPushNotificationToUsers } = await dispatcher;
  let capturedHeaders: Record<string, unknown> = {};
  let capturedPayload: Record<string, any> = {};
  const request = Object.assign(new EventEmitter(), {
    setEncoding() {},
    end(body: string) {
      capturedPayload = JSON.parse(body);
      queueMicrotask(() => {
        request.emit("response", { ":status": 200 });
        request.emit("end");
      });
    },
  });
  const client = Object.assign(new EventEmitter(), {
    request(headers: Record<string, unknown>) {
      capturedHeaders = headers;
      return request;
    },
    setTimeout() {},
    close() {},
    destroy() {},
  });
  const connect = mock.method(http2, "connect", () => client as never);
  try {
    const database = {
      query: {
        userNotificationPreferences: { findMany: async () => [] },
        userPushTokens: { findMany: async () => [{ token: "test-device" }] },
      },
    };
    const result = await sendPushNotificationToUsers(
      ["user"],
      {
        title: "Reminder: Jazz at the Park",
        body: "You’re going tonight at 7 PM.",
        data: {
          type: "event_reminder",
          status: "going",
          actionUrl: "/event/abcdefghijklmnopqrst",
        },
        collapseId: "reminder-event",
        expiresAt: new Date("2026-11-18T00:00:00Z"),
      },
      database as unknown as Parameters<typeof sendPushNotificationToUsers>[2]
    );
    assert.equal(result.successCount, 1);
    assert.equal(capturedHeaders["apns-collapse-id"], "reminder-event");
    assert.equal(
      capturedHeaders["apns-expiration"],
      String(Date.parse("2026-11-18T00:00:00Z") / 1000)
    );
    assert.equal(capturedPayload.data.actionUrl, "/event/abcdefghijklmnopqrst");
    assert.equal(capturedPayload.aps.alert.title, "Reminder: Jazz at the Park");
    const jwt = String(capturedHeaders.authorization)
      .replace("bearer ", "")
      .split(".");
    const signature = Buffer.from(jwt[2], "base64url");
    assert.equal(signature.length, 64);
    assert.equal(
      crypto.verify(
        "sha256",
        Buffer.from(`${jwt[0]}.${jwt[1]}`),
        { key: keys.publicKey, dsaEncoding: "ieee-p1363" },
        signature
      ),
      true
    );
  } finally {
    connect.mock.restore();
  }
});
