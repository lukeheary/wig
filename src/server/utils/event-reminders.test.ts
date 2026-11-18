import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const worker = import("./event-reminders");
const now = new Date("2026-11-17T18:00:00Z");
const base = {
  userId: "user",
  eventId: "event",
  id: "event",
  publicId: "abcdefghijklmnopqrst",
  title: "Jazz at the Park",
  startAt: new Date("2026-11-18T00:00:00Z"),
  timeZone: "America/New_York",
  state: "NY",
  placeName: "Riverside Park",
  status: "going",
  preferences: {},
};
const dialect = new PgDialect();

function fixture() {
  const state = {
    recipient: { ...base },
    current: { ...base } as typeof base | null,
    claim: null as {
      claimToken: string;
      claimedAt: Date;
      sentAt?: Date;
    } | null,
    insertCount: 0,
    pushCount: 0,
  };
  const database = {
    query: {
      events: {
        findMany: async ({
          where,
        }: {
          where: Parameters<PgDialect["sqlToQuery"]>[0];
        }) => {
          const query = dialect.sqlToQuery(where);
          assert.ok(query.params.includes("active"));
          return [state.recipient];
        },
      },
    },
    select: () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: async (where: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          const query = dialect.sqlToQuery(where);
          assert.match(query.sql, /event_source_visibility/);
          assert.match(query.sql, /user_push_tokens/);
          return query.sql.includes("event_reminder_deliveries")
            ? [state.recipient]
            : state.current
              ? [state.current]
              : [];
        },
      };
      return chain;
    },
    insert: () => ({
      values: (values: { claimToken: string; claimedAt: Date }) => ({
        onConflictDoUpdate: ({
          setWhere,
        }: {
          setWhere: Parameters<PgDialect["sqlToQuery"]>[0];
        }) => ({
          returning: async () => {
            state.insertCount++;
            const condition = dialect.sqlToQuery(setWhere).sql;
            assert.match(condition, /"sent_at" is null/);
            assert.match(condition, /"claimed_at" </);
            if (state.claim) return [];
            state.claim = values;
            return [{ claimToken: values.claimToken }];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: { sentAt: Date }) => ({
        where: async () => {
          assert.ok(state.claim);
          Object.assign(state.claim, values);
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        state.claim = null;
      },
    }),
  };
  const send = async (
    _ids: string[],
    payload: {
      title: string;
      body: string;
      data?: Record<string, unknown>;
      collapseId?: string;
      expiresAt?: Date;
    }
  ) => {
    state.pushCount++;
    assert.equal(payload.data?.actionUrl, "/event/abcdefghijklmnopqrst");
    assert.equal(payload.data?.type, "event_reminder");
    assert.equal(payload.collapseId, "reminder-event");
    assert.deepEqual(payload.expiresAt, base.startAt);
    return { successCount: 1 };
  };
  return { state, database, send };
}

test("repeated and overlapping runs send one reminder per user/event", async () => {
  const { sendDueEventReminders } = await worker;
  const f = fixture();
  const db = f.database as unknown as Parameters<
    typeof sendDueEventReminders
  >[0];
  await Promise.all([
    sendDueEventReminders(db, now, f.send),
    sendDueEventReminders(db, now, f.send),
  ]);
  await sendDueEventReminders(db, now, f.send);
  assert.equal(f.state.pushCount, 1);
  assert.ok(f.state.claim?.sentAt);
});

for (const change of [
  "removed",
  "opted-out",
  "master-off",
  "interested-off",
  "rescheduled",
] as const) {
  test(`rechecks ${change} immediately before dispatch`, async () => {
    const { sendDueEventReminders } = await worker;
    const f = fixture();
    if (change === "removed") f.state.current = null;
    if (change === "opted-out")
      f.state.current!.preferences = { goingReminders: false };
    if (change === "master-off")
      f.state.current!.preferences = { pushEnabled: false };
    if (change === "interested-off") {
      f.state.current!.status = "interested";
      f.state.current!.preferences = { interestedReminders: false };
    }
    if (change === "rescheduled")
      f.state.current!.startAt = new Date("2026-11-20T00:00:00Z");
    await sendDueEventReminders(
      f.database as unknown as Parameters<typeof sendDueEventReminders>[0],
      now,
      f.send
    );
    assert.equal(f.state.pushCount, 0);
    assert.equal(f.state.claim, null);
  });
}

test("changed RSVP uses current Interested copy with reminders enabled by default", async () => {
  const { sendDueEventReminders } = await worker;
  const f = fixture();
  f.state.current!.status = "interested";
  await sendDueEventReminders(
    f.database as unknown as Parameters<typeof sendDueEventReminders>[0],
    now,
    async (ids, payload) => {
      assert.equal(payload.title, "Still interested in Jazz at the Park?");
      assert.equal(payload.data?.status, "interested");
      return f.send(ids, payload);
    }
  );
  assert.equal(f.state.pushCount, 1);
});

test("zero accepted deliveries release the claim for retry", async () => {
  const { sendDueEventReminders } = await worker;
  const f = fixture();
  const db = f.database as unknown as Parameters<
    typeof sendDueEventReminders
  >[0];
  await sendDueEventReminders(db, now, async () => ({ successCount: 0 }));
  assert.equal(f.state.claim, null);
  await sendDueEventReminders(db, now, f.send);
  assert.equal(f.state.pushCount, 1);
});
