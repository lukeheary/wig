import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import dotenv from "dotenv";

// Opt-in integration test; only uses disposable rows in the local dev database.
test(
  "hidden profiles exclude other viewers but retain owner access",
  {
    skip: process.env.WIG_TEST_DEV_PROFILE_VISIBILITY !== "true",
  },
  async () => {
    dotenv.config({ path: ".env.local" });
    const { neon } = await import("@neondatabase/serverless");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { sql, and, inArray } = await import("drizzle-orm");
    const { users } = await import("../db/schema");
    const { visibleProfileCondition, isProfileHidden } =
      await import("../utils/profile-visibility");
    const { createNotification, createNotifications } =
      await import("../utils/notifications");
    const { logActivity, upsertRsvpActivity } =
      await import("../utils/activity-logger");
    assert.ok(process.env.DATABASE_URL);
    const query = neon(process.env.DATABASE_URL);
    const suffix = randomUUID().replaceAll("-", "");
    const hiddenId = `visibility-hidden-${suffix}`;
    const publicId = `visibility-public-${suffix}`;
    const ids = [hiddenId, publicId];
    try {
      for (const [id, hidden] of [
        [hiddenId, true],
        [publicId, false],
      ] as const) {
        await query(
          `insert into users (id,email,username,is_onboarding,is_profile_hidden)
        values ($1,$2,$3,false,$4)`,
          [id, `${id}@example.invalid`, id, hidden]
        );
      }
      const visibleIds = async (viewer: string | null) => {
        const statement = sql`select ${users.id} from ${users} where ${and(inArray(users.id, ids), visibleProfileCondition(users.id, viewer))}`;
        const compiled = new PgDialect().sqlToQuery(statement);
        return (await query(compiled.sql, compiled.params))
          .map((row) => row.id)
          .sort();
      };
      assert.deepEqual(await visibleIds(null), [publicId]);
      assert.deepEqual(await visibleIds(publicId), [publicId]);
      assert.deepEqual(await visibleIds(hiddenId), [...ids].sort());
      assert.equal(await isProfileHidden(hiddenId), true);
      const { usersAreBlocked } = await import("../utils/user-blocks");
      assert.equal(await usersAreBlocked(hiddenId, publicId), true);
      assert.equal(await usersAreBlocked(publicId, hiddenId), true);
      if (process.env.WIG_TEST_API_URL) {
        const base = new URL(process.env.WIG_TEST_API_URL);
        assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
        const profile = await fetch(
          new URL(`/api/mobile/users/${hiddenId}`, base)
        );
        assert.equal(profile.status, 404);
        const search = await fetch(
          new URL(`/api/mobile/search?query=${hiddenId}`, base)
        );
        assert.equal(search.status, 200);
        assert.ok(!(await search.text()).includes(hiddenId));
        const support = await fetch(new URL("/support", base), {
          redirect: "manual",
        });
        assert.equal(support.status, 200);
        assert.ok(
          (await support.text()).includes("mailto:support@whoisgoing.com")
        );
      }
      const notification = {
        userId: publicId,
        actorUserId: hiddenId,
        type: "friend_request" as const,
        entityType: "friend_request" as const,
        entityId: randomUUID(),
        title: "Visibility test",
      };
      assert.equal(await createNotification(notification), undefined);
      assert.deepEqual(await createNotifications([notification]), []);
      await logActivity({
        actorUserId: hiddenId,
        type: "rsvp_going",
        entityType: "event",
        entityId: randomUUID(),
      });
      await upsertRsvpActivity({
        actorUserId: hiddenId,
        type: "rsvp_going",
        entityId: randomUUID(),
      });
      assert.equal(
        (
          await query("select id from user_activity where actor_user_id = $1", [
            hiddenId,
          ])
        ).length,
        0
      );
      const { appRouter } = await import("../trpc/root");
      const { db } = await import("../db");
      const caller = (userId: string) =>
        appRouter.createCaller({ db, auth: { userId } as any });
      await assert.rejects(
        caller(publicId).admin.setProfileVisibility({
          userId: hiddenId,
          hidden: false,
        }),
        (error: any) => error.code === "FORBIDDEN"
      );
      await query("update users set role='admin' where id=$1", [publicId]);
      await caller(publicId).admin.setProfileVisibility({
        userId: hiddenId,
        hidden: false,
      });
      assert.deepEqual(await visibleIds(publicId), [...ids].sort());
    } finally {
      await query("delete from users where id = any($1::text[])", [ids]);
    }
  }
);
