import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

// The dispatcher receives a fake database and no tokens. No database or APNs
// connection is made; dummy configuration only exercises the configured path.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.APNS_KEY_ID = "test";
process.env.APNS_TEAM_ID = "test";
process.env.APNS_PRIVATE_KEY = "test";
process.env.APNS_BUNDLE_ID = "test";
const dispatcher = import("./push-notifications");
const dialect = new PgDialect();

test("dispatcher filters each recipient before looking up push tokens", async () => {
  const { sendPushNotificationToUsers, sendBackgroundPushToUsers } =
    await dispatcher;
  let tokenUserIds: unknown[] = [];
  const database = {
    query: {
      userNotificationPreferences: {
        findMany: async () => [
          { userId: "muted-category", preferences: { friendsGoing: false } },
          { userId: "master-off", preferences: { pushEnabled: false } },
          { userId: "allowed", preferences: { friendsGoing: true } },
        ],
      },
      userPushTokens: {
        findMany: async ({
          where,
        }: {
          where: Parameters<PgDialect["sqlToQuery"]>[0];
        }) => {
          tokenUserIds = dialect.sqlToQuery(where).params;
          return [];
        },
      },
    },
  };
  await sendPushNotificationToUsers(
    ["muted-category", "master-off", "allowed", "new-account"],
    {
      title: "Test",
      body: "Going",
      data: { type: "event_update", source: "friend_rsvp", status: "going" },
    },
    database as unknown as Parameters<typeof sendPushNotificationToUsers>[2]
  );
  assert.deepEqual(tokenUserIds, ["allowed", "new-account"]);
});

test("an all-muted audience never reaches token lookup or APNs", async () => {
  const { sendPushNotificationToUsers, sendBackgroundPushToUsers } =
    await dispatcher;
  const database = {
    query: {
      userNotificationPreferences: {
        findMany: async () => [
          { userId: "off", preferences: { pushEnabled: false } },
        ],
      },
      userPushTokens: {
        findMany: async () => {
          assert.fail("Token lookup should be skipped");
        },
      },
    },
  };
  await sendPushNotificationToUsers(
    ["off"],
    { title: "Test", body: "Request", data: { type: "friend_request" } },
    database as unknown as Parameters<typeof sendPushNotificationToUsers>[2]
  );
});

test("preference read failures skip alerts without failing the initiating action", async () => {
  const { sendPushNotificationToUsers, sendBackgroundPushToUsers } =
    await dispatcher;
  const database = {
    query: {
      userNotificationPreferences: {
        findMany: async () => {
          throw new Error("offline");
        },
      },
      userPushTokens: {
        findMany: async () => {
          assert.fail("Unknown preferences must not send alerts");
        },
      },
    },
  };
  await assert.doesNotReject(
    sendPushNotificationToUsers(
      ["off"],
      { title: "Test", body: "Request" },
      database as unknown as Parameters<typeof sendPushNotificationToUsers>[2]
    )
  );
});

test("silent refresh pushes do not consult alert preferences", async () => {
  const { sendPushNotificationToUsers, sendBackgroundPushToUsers } =
    await dispatcher;
  let queried = false;
  const database = {
    query: {
      userNotificationPreferences: {
        findMany: async () => {
          assert.fail("Silent refresh must remain independent");
        },
      },
      userPushTokens: {
        findMany: async () => {
          queried = true;
          return [];
        },
      },
    },
  };
  await sendBackgroundPushToUsers(
    ["off"],
    { data: { type: "profile_updated" } },
    database as unknown as Parameters<typeof sendBackgroundPushToUsers>[2]
  );
  assert.equal(queried, true);
});
