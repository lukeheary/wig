import {
  ATTEMPT_BUDGET_MS,
  BATCH_SIZE,
  SCRAPER_TYPES,
  START_WORK_BUDGET_MS,
} from "./policy";
import { withScrapeRuntime, type ScrapeRuntime } from "./runtime";
import type { DueScraper, ScraperStore } from "./store";

export interface ScraperResult {
  status: "success" | "error" | "partial";
  eventsFound: number;
  eventsAdded: number;
  error: string | null;
  data: {
    eventsFound: { title: string; externalId: string | null }[];
    eventsAdded: { id: string; title: string; externalId: string | null }[];
    warnings?: string[];
  };
}

export async function runScraperBatch(options: {
  store: ScraperStore;
  execute: (row: DueScraper, adminId: string) => Promise<ScraperResult>;
  poshEnabled: boolean;
  now?: () => Date;
}) {
  const { store, execute, poshEnabled } = options;
  const now = options.now ?? (() => new Date());
  const started = now().getTime();
  const token = await store.acquireLock();
  if (!token)
    return {
      ok: true,
      skipped: true,
      reason: "Another scraper runner is active",
    };
  try {
    const cooldowns = await store.cooldowns();
    const allowed = SCRAPER_TYPES.filter(
      (provider) =>
        (provider !== "posh" || poshEnabled) &&
        !(Date.parse(cooldowns[provider] ?? "") > now().getTime())
    );
    const rows = await store.due(allowed, now(), BATCH_SIZE);
    if (!rows.length) return { ok: true, attempted: 0, results: [] };
    const adminId = await store.adminId();
    const results = [];
    const ticketmasterPacing = { nextAt: 0, intervalMs: 1_000 };
    for (const row of rows) {
      if (now().getTime() - started >= START_WORK_BUDGET_MS) break;
      if (Date.parse(cooldowns[row.scraper] ?? "") > now().getTime()) continue;
      let attempts: number | null;
      const attemptedAt = now();
      try {
        attempts = await store.markAttempt(row.id, attemptedAt, row);
      } catch (error) {
        console.error("Could not start scraper", row.id, error);
        continue;
      }
      if (attempts === null) continue;
      const attemptStarted = now().getTime();
      const runtime: ScrapeRuntime = {
        signal: AbortSignal.timeout(ATTEMPT_BUDGET_MS),
        cooldownUntil: null,
        warnings: [],
        pacing: row.scraper === "ticketmaster" ? ticketmasterPacing : undefined,
      };
      let result: ScraperResult;
      try {
        result = await withScrapeRuntime(runtime, () => execute(row, adminId));
        if (runtime.signal.aborted)
          throw new Error("Scraper exceeded its 90-second attempt budget");
        if (
          (runtime.cooldownUntil || runtime.incomplete) &&
          result.status === "success"
        ) {
          result = {
            ...result,
            status: "partial",
            error: "Provider response was incomplete",
          };
        }
        if (result.status === "success")
          await store.succeeded(row.id, now(), attemptedAt);
      } catch (error) {
        result = {
          status: "error",
          eventsFound: 0,
          eventsAdded: 0,
          error: error instanceof Error ? error.message : "Scraper failed",
          data: { eventsFound: [], eventsAdded: [] },
        };
      }
      if (runtime.cooldownUntil) {
        cooldowns[row.scraper] = runtime.cooldownUntil.toISOString();
        try {
          await store.setCooldown(row.scraper, runtime.cooldownUntil);
          await store.defer(
            row.id,
            attempts,
            now(),
            runtime.cooldownUntil,
            attemptedAt
          );
        } catch (error) {
          console.error("Could not save provider cooldown", error);
        }
      }
      const durationMs = now().getTime() - attemptStarted;
      if (runtime.warnings.length) result.data.warnings = runtime.warnings;
      try {
        await store.log({
          scraperId: row.id,
          placeId: row.placeId,
          placeName: row.place.name,
          scraper: row.scraper,
          ...result,
          durationMs,
          ranAt: now(),
        });
      } catch (error) {
        console.error("Could not save scraper log", row.id, error);
      }
      results.push({
        scraperId: row.id,
        placeName: row.place.name,
        ...result,
        durationMs,
      });
    }
    return { ok: true, attempted: results.length, results };
  } finally {
    await store.releaseLock(token);
  }
}
