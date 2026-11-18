import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { saveEventRsvp } from "./save-event-rsvp";

type SavedRsvp = {
  userId: string;
  eventId: string;
  status: "going" | "interested" | "not_going";
  notGoingReason: "busy" | null;
  partnerRsvpByUserId: string | null;
};
const eventId = "event-1";
const dialect = new PgDialect();

function fixture() {
  let rows = new Map<string, SavedRsvp>();
  const batches: string[][] = [];
  let failUser: string | undefined;
  const fake = {
    async transaction<T>(run: (tx: unknown) => Promise<T>) {
      const before = new Map(rows);
      const tx = {
        insert() {
          return {
            values(writes: SavedRsvp[]) {
              batches.push(writes.map((row) => row.userId));
              return {
                onConflictDoUpdate(config: { set: { partnerRsvpByUserId: Parameters<PgDialect["sqlToQuery"]>[0] } }) {
                  // Each conflicting row must keep its own ownership value.
                  assert.match(dialect.sqlToQuery(config.set.partnerRsvpByUserId).sql, /excluded\.partner_rsvp_by_user_id/);
                  return {
                    async returning() {
                      for (const row of writes) {
                        if (row.userId === failUser) throw new Error("write failed");
                        rows.set(row.userId, { ...row });
                      }
                      return writes.map((row) => ({ ...row }));
                    },
                  };
                },
              };
            },
          };
        },
        delete() {
          return {
            async where(condition: Parameters<PgDialect["sqlToQuery"]>[0]) {
              const { params } = dialect.sqlToQuery(condition);
              const [partnerId, requestedEvent, actorId] = params as string[];
              const partner = rows.get(partnerId);
              if (partner?.eventId === requestedEvent && partner.partnerRsvpByUserId === actorId) {
                rows.delete(partnerId);
              }
            },
          };
        },
      };
      try {
        return await run(tx);
      } catch (error) {
        rows = before;
        throw error;
      }
    },
  };
  const database = fake as unknown as Parameters<typeof saveEventRsvp>[0];
  return {
    get rows() { return rows; },
    batches,
    failOn(user: string) { failUser = user; },
    save(userId: string, partnerUserId: string | null, status: SavedRsvp["status"], includePartner = true) {
      return saveEventRsvp(database, { userId, eventId, partnerUserId, status, includePartner, notGoingReason: null });
    },
  };
}

test("either partner can change both from interested to going and back", async () => {
  for (const [first, second] of [["Luke", "Jake"], ["Jake", "Luke"]]) {
    const f = fixture();
    await f.save(first, second, "interested");
    const result = await f.save(second, first, "going");
    assert.equal(result.includedPartner, true);
    assert.equal(result.rsvp.userId, second);
    assert.equal(f.rows.get(first)?.status, "going");
    assert.equal(f.rows.get(second)?.status, "going");
    await f.save(first, second, "interested");
    assert.equal(f.rows.get(first)?.status, "interested");
    assert.equal(f.rows.get(second)?.status, "interested");
    assert.deepEqual(f.batches, [["Jake", "Luke"], ["Jake", "Luke"], ["Jake", "Luke"]]);
  }
});

test("enabling shared RSVP updates mismatched independent responses", async () => {
  const f = fixture();
  await f.save("Luke", null, "interested");
  await f.save("Jake", null, "going");
  const result = await f.save("Luke", "Jake", "interested");
  assert.equal(result.includedPartner, true);
  assert.equal(f.rows.get("Jake")?.status, "interested");
  assert.equal(f.rows.get("Jake")?.partnerRsvpByUserId, "Luke");
});

test("opting out preserves a partner's independent RSVP", async () => {
  const f = fixture();
  await f.save("Jake", null, "going");
  await f.save("Luke", "Jake", "interested", false);
  assert.equal(f.rows.get("Jake")?.status, "going");
  assert.equal(f.rows.get("Luke")?.status, "interested");
});

test("opting out removes only the RSVP previously made for the partner", async () => {
  const f = fixture();
  await f.save("Luke", "Jake", "interested");
  const result = await f.save("Luke", "Jake", "going", false);
  assert.equal(result.includedPartner, false);
  assert.equal(f.rows.has("Jake"), false);
  assert.equal(f.rows.get("Luke")?.status, "going");
});

test("a caller without an accepted partner cannot write a second RSVP", async () => {
  const f = fixture();
  const result = await f.save("Luke", null, "going");
  assert.equal(result.includedPartner, false);
  assert.deepEqual([...f.rows.keys()], ["Luke"]);
});

test("a failed pair update rolls back the transaction", async () => {
  const f = fixture();
  await f.save("Luke", "Jake", "interested");
  f.failOn("Luke");
  await assert.rejects(f.save("Jake", "Luke", "going"), /write failed/);
  assert.equal(f.rows.get("Luke")?.status, "interested");
  assert.equal(f.rows.get("Jake")?.status, "interested");
});
