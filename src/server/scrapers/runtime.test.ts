import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  mapConcurrent,
  retryAfterDate,
  scraperFetch,
  withScrapeRuntime,
} from "./runtime";
import { isCronAuthorized, retryDelayMs, runnerMode } from "./policy";

test("runner modes default to batch and fail closed for unknown values", (t) => {
  const previous = process.env.SCRAPER_RUNNER_MODE;
  delete process.env.SCRAPER_RUNNER_MODE;
  t.after(() => {
    if (previous === undefined) delete process.env.SCRAPER_RUNNER_MODE;
    else process.env.SCRAPER_RUNNER_MODE = previous;
  });
  assert.equal(runnerMode(), "batch");
  assert.equal(runnerMode("batch"), "batch");
  assert.equal(runnerMode("legacy"), "legacy");
  assert.equal(runnerMode("off"), "off");
  assert.equal(runnerMode("typo"), "off");
  assert.deepEqual(
    [1, 2, 3, 4, 50].map(retryDelayMs),
    [30, 120, 360, 1440, 1440].map((n) => n * 60_000)
  );
});

test("parallel 429 responses retain the longest cooldown", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const long = String(input).endsWith("long");
    await delay(long ? 1 : 10);
    return new Response("limited", {
      status: 429,
      headers: { "retry-after": long ? "7200" : "60" },
    });
  });
  const runtime = {
    signal: AbortSignal.timeout(1_000),
    warnings: [],
    cooldownUntil: null as Date | null,
  };
  await withScrapeRuntime(runtime, () =>
    Promise.allSettled([
      scraperFetch("https://example.test/long"),
      scraperFetch("https://example.test/short"),
    ])
  );
  assert.ok(runtime.cooldownUntil!.getTime() > Date.now() + 7_100_000);
});

test("cron endpoints reject absent secrets and incorrect credentials", (t) => {
  const previous = process.env.CRON_SECRET;
  t.after(() => {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });
  delete process.env.CRON_SECRET;
  assert.equal(isCronAuthorized(new Request("http://localhost")), false);
  process.env.CRON_SECRET = "test-secret";
  assert.equal(
    isCronAuthorized(
      new Request("http://localhost", {
        headers: { authorization: "Bearer wrong" },
      })
    ),
    false
  );
  assert.equal(
    isCronAuthorized(
      new Request("http://localhost", {
        headers: { authorization: "Bearer test-secret" },
      })
    ),
    true
  );
});

test("concurrency is bounded and in-flight work is drained before failure returns", async () => {
  let active = 0,
    maximum = 0,
    finished = 0;
  await assert.rejects(
    mapConcurrent([0, 1, 2, 3, 4], 2, async (index) => {
      maximum = Math.max(maximum, ++active);
      try {
        await delay(index === 0 ? 5 : 30);
        if (index === 0) throw new Error("failure");
        finished++;
      } finally {
        active--;
      }
    }),
    /failure/
  );
  assert.equal(maximum, 2);
  assert.equal(active, 0);
  assert.equal(finished, 1);
});

test("batch deadlines cancel the actual HTTP request", async (t) => {
  let requestSignal: AbortSignal | null = null;
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init: RequestInit) => {
      requestSignal = init.signal!;
      await delay(1_000, undefined, { signal: init.signal! });
      return new Response("ok");
    }
  );
  await assert.rejects(
    withScrapeRuntime(
      { signal: AbortSignal.timeout(10), warnings: [], cooldownUntil: null },
      () =>
        scraperFetch("https://example.test", {
          signal: AbortSignal.timeout(2_000),
        })
    )
  );
  assert.equal((requestSignal as AbortSignal | null)?.aborted, true);
});

test("429 captures Retry-After and prevents additional requests in the attempt", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response("limited", {
      status: 429,
      headers: { "retry-after": "7200" },
    });
  });
  const runtime = {
    signal: AbortSignal.timeout(1_000),
    warnings: [],
    cooldownUntil: null as Date | null,
  };
  await withScrapeRuntime(runtime, async () => {
    await assert.rejects(scraperFetch("https://example.test"), /429/);
    await assert.rejects(scraperFetch("https://example.test"), /cooling down/);
  });
  assert.equal(requests, 1);
  assert.ok(runtime.cooldownUntil!.getTime() > Date.now() + 7_100_000);
  const now = new Date("2026-11-18T12:00:00Z");
  assert.equal(
    retryAfterDate("Wed, 18 Nov 2026 14:00:00 GMT", now).toISOString(),
    "2026-11-18T14:00:00.000Z"
  );
  assert.equal(
    retryAfterDate(null, now).getTime(),
    now.getTime() + 30 * 60_000
  );
});
