import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import dotenv from "dotenv";

test(
  "event source preferences are account-scoped and admin-only",
  {
    skip: process.env.WIG_TEST_DEV_SOURCE_VISIBILITY !== "true",
  },
  async () => {
    dotenv.config({ path: ".env.local" });
    const { neon } = await import("@neondatabase/serverless");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { sql } = await import("drizzle-orm");
    const { eventSourceVisibilityCondition, EVENT_SOURCES } =
      await import("../utils/event-source-visibility");
    const { appRouter } = await import("../trpc/root");
    const { db } = await import("../db");
    assert.ok(process.env.DATABASE_URL);
    const query = neon(process.env.DATABASE_URL);
    const suffix = randomUUID().replaceAll("-", "");
    const adminId = `source-admin-${suffix}`;
    const qaId = `source-qa-${suffix}`;
    const normalId = `source-user-${suffix}`;
    const ids = [adminId, qaId, normalId];
    const caller = (userId: string) =>
      appRouter.createCaller({ db, auth: { userId } as any });
    try {
      for (const id of ids) {
        await query(
          "insert into users (id,email,username,role,is_onboarding) values ($1,$2,$3,$4,false)",
          [id, `${id}@example.invalid`, id, id === adminId ? "admin" : "user"]
        );
      }
      const settings = await caller(adminId).admin.getUserEventSources({
        userId: qaId,
      });
      const source = settings.find(
        (setting) => !setting.globallyHidden
      )?.source;
      assert.ok(source, "Dev test needs at least one globally visible source");
      const visible = async (viewerId: string | null) => {
        const statement = sql`select source from (values (${source}::text), (NULL::text)) as sample(source)
        where ${eventSourceVisibilityCondition(sql`sample.source`, viewerId)} order by source nulls last`;
        const compiled = new PgDialect().sqlToQuery(statement);
        return (await query(compiled.sql, compiled.params)).map(
          (row) => row.source
        );
      };
      await assert.rejects(
        caller(normalId).admin.setUserEventSourceVisibility({
          userId: qaId,
          source,
          hidden: true,
        }),
        (error: any) => error.code === "FORBIDDEN"
      );
      await assert.rejects(
        caller(normalId).admin.getUserEventSources({ userId: qaId }),
        (error: any) => error.code === "FORBIDDEN"
      );
      await assert.rejects(
        caller(adminId).admin.setUserEventSourceVisibility({
          userId: "missing-user",
          source,
          hidden: true,
        }),
        (error: any) => error.code === "NOT_FOUND"
      );
      await caller(adminId).admin.setUserEventSourceVisibility({
        userId: qaId,
        source,
        hidden: true,
      });
      assert.deepEqual(await visible(qaId), [null]);
      assert.deepEqual(await visible(normalId), [source, null]);
      assert.deepEqual(await visible(null), [source, null]);
      assert.equal(
        (
          await caller(adminId).admin.getUserEventSources({ userId: qaId })
        ).find((row) => row.source === source)?.hidden,
        true
      );
      assert.ok(
        (
          await caller(adminId).admin.getUserEventSources({ userId: normalId })
        ).every((row) => !row.hidden)
      );
      // Adding another source leaves the first preference intact.
      const second = EVENT_SOURCES.find((value) => value !== source)!;
      await caller(adminId).admin.setUserEventSourceVisibility({
        userId: qaId,
        source: second,
        hidden: true,
      });
      assert.equal(
        (
          await query(
            "select source from user_event_source_visibility where user_id=$1 and hidden=true",
            [qaId]
          )
        ).length,
        2
      );
      await caller(adminId).admin.setUserEventSourceVisibility({
        userId: qaId,
        source,
        hidden: false,
      });
      assert.deepEqual(await visible(qaId), [source, null]);
    } finally {
      await query("delete from users where id=any($1::text[])", [ids]);
      assert.equal(
        (
          await query(
            "select user_id from user_event_source_visibility where user_id=any($1::text[])",
            [ids]
          )
        ).length,
        0
      );
    }
  }
);
