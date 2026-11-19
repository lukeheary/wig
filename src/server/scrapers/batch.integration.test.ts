import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { before, after, beforeEach, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { createScraperStore } from "./store";
import { runScraperBatch, type ScraperResult } from "./batch";
import { runScraper } from "./run-scraper";
import { withScrapeRuntime } from "./runtime";
import { resetScraperSchedule } from "./policy";

// Opt-in and restricted to a disposable localhost database. Never run against the app database.
const url = process.env.SCRAPER_TEST_DATABASE_URL;
const enabled = Boolean(
  url &&
  process.env.SCRAPER_TEST_SCHEMA_PATH &&
  process.env.SCRAPER_TEST_PG_MODULE
);
const integration = enabled ? test : test.skip;
const require = createRequire(import.meta.url);
let pool: any;
let database: typeof import("@/server/db").db;
let store: ReturnType<typeof createScraperStore>;

before(async () => {
  if (!enabled) return;
  const target = new URL(url!);
  assert.ok(
    ["127.0.0.1", "localhost"].includes(target.hostname) &&
      target.pathname === "/wig_scraper_test",
    "Only the disposable localhost test database may be reset"
  );
  const { Pool } = require(process.env.SCRAPER_TEST_PG_MODULE!);
  pool = new Pool({ connectionString: url });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await pool.query(readFileSync(process.env.SCRAPER_TEST_SCHEMA_PATH!, "utf8"));
  // Reconstruct the pre-change tables, preserving a real existing configuration across the migration.
  await pool.query(`DROP TABLE scraper_runner_lock;
    DROP INDEX scraper_logs_ran_at_idx; DROP INDEX scraper_logs_scraper_ran_at_idx;
    ALTER TABLE scrapers DROP COLUMN next_run_at, DROP COLUMN last_attempt_at,
      DROP COLUMN last_success_at, DROP COLUMN attempts_since_success;
    INSERT INTO places(id,type,slug,name,city,state) VALUES('00000000-0000-0000-0000-000000000001','venue','existing','Existing','Chicago','IL');
    INSERT INTO scrapers(place_id,scraper,search_string) VALUES('00000000-0000-0000-0000-000000000001','dice','https://dice.fm/venue/existing')`);
  await pool.query(
    readFileSync(
      "src/server/db/migrations/0077_scraper_batch_runner.sql",
      "utf8"
    )
  );
  const migrated = await pool.query(
    "SELECT next_run_at,attempts_since_success FROM scrapers"
  );
  assert.equal(migrated.rowCount, 1);
  assert.equal(migrated.rows[0].attempts_since_success, 0);
  assert.ok(migrated.rows[0].next_run_at);
  database = drizzle(pool, { schema }) as unknown as typeof database;
  store = createScraperStore(database);
});

after(async () => {
  if (pool) await pool.end();
});
beforeEach(async () => {
  if (!enabled) return;
  await pool.query(
    "TRUNCATE places,users,categories,scraper_runner_lock CASCADE"
  );
  await database.insert(schema.users).values({
    id: "admin",
    email: "test@example.test",
    username: "admin",
    role: "admin",
  });
});

async function seed(
  count: number,
  provider: "dice" | "posh" | "ticketmaster" | "eventbrite" = "dice",
  isEnabled = true
) {
  const [place] = await database
    .insert(schema.places)
    .values({
      type: "venue",
      slug: `place-${provider}-${isEnabled}`,
      name: "Example",
      city: "Chicago",
      state: "IL",
      isEnabled,
    })
    .returning();
  const rows = await database
    .insert(schema.scrapers)
    .values(
      Array.from({ length: count }, (_, i) => ({
        placeId: place.id,
        scraper: provider,
        searchString: `https://dice.fm/venue/example-${i}`,
        nextRunAt: new Date(0),
      }))
    )
    .returning();
  return rows.map((row) => ({ ...row, place }));
}

const success = (): ScraperResult => ({
  status: "success",
  eventsFound: 0,
  eventsAdded: 0,
  error: null,
  data: { eventsFound: [], eventsAdded: [] },
});

integration(
  "100 configurations drain in ten bounded batches and successful work is skipped",
  async () => {
    await seed(100);
    let executions = 0;
    for (let tick = 0; tick < 10; tick++) {
      const result = await runScraperBatch({
        store,
        poshEnabled: false,
        execute: async () => {
          executions++;
          return success();
        },
      });
      assert.equal(result.attempted, 10);
    }
    assert.equal(executions, 100);
    const next = await runScraperBatch({
      store,
      poshEnabled: false,
      execute: async () => {
        throw new Error("Must not rerun successful work");
      },
    });
    assert.equal(next.attempted, 0);
    const state = await pool.query(
      "SELECT count(*)::int n FROM scrapers WHERE last_success_at IS NOT NULL AND attempts_since_success=0 AND next_run_at>now()+interval '23 hours'"
    );
    assert.equal(state.rows[0].n, 100);
  }
);

integration(
  "competing runners cannot acquire the same lock; an expired owner cannot release its replacement",
  async () => {
    const tokens = await Promise.all([
      store.acquireLock(),
      store.acquireLock(),
    ]);
    assert.equal(tokens.filter(Boolean).length, 1);
    const old = tokens.find(Boolean)!;
    await pool.query(
      "UPDATE scraper_runner_lock SET locked_until=now()-interval '1 second'"
    );
    const replacement = await store.acquireLock();
    assert.ok(replacement);
    assert.notEqual(old, replacement);
    await store.releaseLock(old);
    assert.equal(await store.acquireLock(), null);
    await store.releaseLock(replacement!);
    assert.ok(await store.acquireLock());
  }
);

integration(
  "interruption after starting an attempt leaves a persistent retry rather than immediate duplicate work",
  async () => {
    const [row] = await seed(1);
    const now = new Date();
    assert.equal(await store.markAttempt(row.id, now), 1);
    assert.equal((await store.due(["dice"], now, 10)).length, 0);
    assert.equal(
      (await store.due(["dice"], new Date(now.getTime() + 31 * 60_000), 10))
        .length,
      1
    );
    assert.equal(
      await store.markAttempt(row.id, new Date(now.getTime() + 31 * 60_000)),
      2
    );
    const [saved] = await database
      .select()
      .from(schema.scrapers)
      .where(eq(schema.scrapers.id, row.id));
    assert.equal(saved.attemptsSinceSuccess, 2);
    assert.equal(saved.lastSuccessAt, null);
    assert.equal(
      saved.nextRunAt.getTime(),
      now.getTime() + (31 + 120) * 60_000
    );
  }
);

integration(
  "one scraper failure and one log failure do not stop healthy scrapers",
  async () => {
    await seed(3);
    let attempts = 0,
      logs = 0;
    const result = await runScraperBatch({
      store: {
        ...store,
        log: async (value) => {
          if (++logs === 1) throw new Error("log unavailable");
          await store.log(value);
        },
      },
      poshEnabled: false,
      execute: async () => {
        if (++attempts === 1) throw new Error("venue unavailable");
        return success();
      },
    });
    assert.equal(result.attempted, 3);
    const state = await pool.query(
      "SELECT count(*) FILTER(WHERE last_success_at IS NOT NULL)::int succeeded,count(*) FILTER(WHERE attempts_since_success=1)::int retrying FROM scrapers"
    );
    assert.deepEqual(state.rows[0], { succeeded: 2, retrying: 1 });
  }
);

integration(
  "disabled places and Posh opt-out are excluded; persisted provider cooldowns survive a new tick",
  async () => {
    await seed(1, "dice", false);
    await seed(2, "posh");
    await seed(2, "ticketmaster");
    let executions = 0;
    const first = await runScraperBatch({
      store,
      poshEnabled: false,
      execute: async () => {
        executions++;
        const { getScrapeRuntime } = await import("./runtime");
        getScrapeRuntime()!.cooldownUntil = new Date(
          Date.now() + 2 * 60 * 60_000
        );
        return { ...success(), status: "error", error: "HTTP 429" };
      },
    });
    assert.equal(first.attempted, 1);
    await runScraperBatch({
      store,
      poshEnabled: false,
      execute: async () => {
        executions++;
        return success();
      },
    });
    assert.equal(executions, 1);
    assert.ok(Date.parse((await store.cooldowns()).ticketmaster) > Date.now());
  }
);

integration(
  "the batch stops starting work at its time budget and releases its lock",
  async () => {
    await seed(10);
    let clock = Date.now();
    const result = await runScraperBatch({
      store,
      poshEnabled: false,
      now: () => new Date(clock),
      execute: async () => {
        clock += 90_000;
        return success();
      },
    });
    assert.equal(result.attempted, 2);
    assert.ok(await store.acquireLock());
  }
);

integration(
  "a repeated import repairs missing categories without duplicating the event",
  async (t) => {
    const [row] = await seed(1);
    await database
      .insert(schema.categories)
      .values({ key: "concerts", label: "Concerts" });
    const listing = `<script type="application/ld+json">${JSON.stringify({ "@type": "Place", name: "Example", address: "1 Main St, Chicago, IL 60601, USA", event: [{ name: "Live Music", description: "Concert", url: "https://dice.fm/event/012345678901234567890123", startDate: "2027-01-01T20:00:00Z" }] })}</script>`;
    t.mock.method(globalThis, "fetch", async () => new Response(listing));
    const run = () =>
      withScrapeRuntime(
        {
          signal: AbortSignal.timeout(5_000),
          cooldownUntil: null,
          warnings: [],
        },
        () => runScraper(row, "admin", database)
      );
    assert.equal((await run()).eventsAdded, 1);
    await pool.query("DELETE FROM event_categories");
    assert.equal((await run()).eventsAdded, 0);
    const counts = await pool.query(
      "SELECT (SELECT count(*)::int FROM events) events,(SELECT count(*)::int FROM event_categories) categories"
    );
    assert.deepEqual(counts.rows[0], { events: 1, categories: 1 });
  }
);

integration(
  "mode switches disable the opposite endpoint before it can touch its database",
  async () => {
    const previousMode = process.env.SCRAPER_RUNNER_MODE,
      previousSecret = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = "test-secret";
      const { NextRequest } = await import("next/server");
      const batch = await import("@/app/api/cron/run-scrapers/route");
      const legacy =
        await import("@/app/api/cron/run-scrapers/[scraper]/route");
      const request = () =>
        new NextRequest("http://localhost/api/cron/run-scrapers", {
          headers: { authorization: "Bearer test-secret" },
        });
      process.env.SCRAPER_RUNNER_MODE = "batch";
      assert.equal(
        (
          await (
            await legacy.GET(request(), {
              params: Promise.resolve({ scraper: "dice" }),
            })
          ).json()
        ).skipped,
        true
      );
      process.env.SCRAPER_RUNNER_MODE = "legacy";
      assert.equal((await (await batch.GET(request())).json()).skipped, true);
      process.env.SCRAPER_RUNNER_MODE = "off";
      assert.equal((await (await batch.GET(request())).json()).skipped, true);
      assert.equal(
        (
          await (
            await legacy.GET(request(), {
              params: Promise.resolve({ scraper: "dice" }),
            })
          ).json()
        ).skipped,
        true
      );
    } finally {
      if (previousMode === undefined) delete process.env.SCRAPER_RUNNER_MODE;
      else process.env.SCRAPER_RUNNER_MODE = previousMode;
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
    }
  }
);

integration(
  "editing a configuration invalidates stale claims and completion",
  async () => {
    const [row] = await seed(1);
    const attemptedAt = new Date();
    assert.equal(await store.markAttempt(row.id, attemptedAt, row), 1);
    await database
      .update(schema.scrapers)
      .set({
        searchString: "https://dice.fm/venue/new",
        ...resetScraperSchedule(),
      })
      .where(eq(schema.scrapers.id, row.id));
    await store.succeeded(row.id, new Date(), attemptedAt);
    const [saved] = await database
      .select()
      .from(schema.scrapers)
      .where(eq(schema.scrapers.id, row.id));
    assert.equal(saved.lastSuccessAt, null);
    assert.equal(await store.markAttempt(row.id, new Date(), row), null);
  }
);

integration(
  "incomplete listings remain due for retry and never advance success",
  async () => {
    const [row] = await seed(1);
    await runScraperBatch({
      store,
      poshEnabled: false,
      execute: async () => ({
        ...success(),
        status: "partial",
        error: "More pages remain",
      }),
    });
    const [saved] = await database
      .select()
      .from(schema.scrapers)
      .where(eq(schema.scrapers.id, row.id));
    assert.equal(saved.lastSuccessAt, null);
    assert.equal(saved.attemptsSinceSuccess, 1);
    assert.ok(saved.nextRunAt.getTime() < Date.now() + 31 * 60_000);
  }
);

integration(
  "image failure is recorded as a warning without failing a complete event import",
  async (t) => {
    const [row] = await seed(1);
    await database
      .insert(schema.categories)
      .values({ key: "clubs", label: "Clubs" });
    const listing = `<script type="application/ld+json">${JSON.stringify({ "@type": "Place", name: "Example", address: "1 Main St, Chicago, IL 60601, USA", event: [{ name: "DJ Night", description: "Dance party", url: "https://dice.fm/event/012345678901234567890123", image: ["https://images.example.test/cover.jpg"], startDate: "2027-01-01T20:00:00Z" }] })}</script>`;
    t.mock.method(globalThis, "fetch", async (input: string | URL) =>
      new URL(input).hostname === "images.example.test"
        ? new Response("unavailable", { status: 503 })
        : new Response(listing)
    );
    const result = await runScraperBatch({
      store,
      poshEnabled: false,
      execute: (value, adminId) => runScraper(value, adminId, database),
    });
    assert.equal(result.results?.[0].status, "success");
    assert.ok(result.results?.[0].data.warnings?.length);
    const [saved] = await database
      .select()
      .from(schema.scrapers)
      .where(eq(schema.scrapers.id, row.id));
    assert.ok(saved.lastSuccessAt);
  }
);
