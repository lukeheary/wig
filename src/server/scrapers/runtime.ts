import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

export interface ScrapeRuntime {
  signal: AbortSignal;
  cooldownUntil: Date | null;
  warnings: string[];
  incomplete?: boolean;
  pacing?: { nextAt: number; intervalMs: number };
}

const storage = new AsyncLocalStorage<ScrapeRuntime>();
export const getScrapeRuntime = () => storage.getStore();
export const withScrapeRuntime = <T>(
  runtime: ScrapeRuntime,
  work: () => Promise<T>
) => storage.run(runtime, work);

export function assertScrapeActive() {
  getScrapeRuntime()?.signal.throwIfAborted();
}

export function retryAfterDate(value: string | null, now = new Date()): Date {
  const seconds = value?.trim() ? Number(value) : NaN;
  const timestamp = Number.isFinite(seconds)
    ? now.getTime() + Math.max(0, seconds) * 1000
    : Date.parse(value ?? "");
  return new Date(
    Math.max(now.getTime() + 60_000, timestamp || now.getTime() + 30 * 60_000)
  );
}

function extendCooldown(runtime: ScrapeRuntime, until: Date) {
  runtime.cooldownUntil = new Date(
    Math.max(until.getTime(), runtime.cooldownUntil?.getTime() ?? 0)
  );
}

/** Legacy/manual calls keep their existing fetch behavior outside a batch runtime. */
export async function scraperFetch(
  input: string | URL,
  init: RequestInit = {}
) {
  const runtime = getScrapeRuntime();
  if (!runtime) return fetch(input, init);
  runtime.signal.throwIfAborted();
  if (runtime.cooldownUntil)
    throw new Error("Provider is cooling down after HTTP 429");
  if (runtime.pacing) {
    const now = Date.now();
    const wait = Math.max(0, runtime.pacing.nextAt - now);
    runtime.pacing.nextAt =
      Math.max(now, runtime.pacing.nextAt) + runtime.pacing.intervalMs;
    if (wait) await delay(wait, undefined, { signal: runtime.signal });
  }
  const response = await fetch(input, {
    ...init,
    signal: init.signal
      ? AbortSignal.any([runtime.signal, init.signal])
      : runtime.signal,
  });
  if (response.status === 429) {
    const until = retryAfterDate(response.headers.get("retry-after"));
    extendCooldown(runtime, until);
    await response.body?.cancel();
    throw new Error(`HTTP 429; retry after ${until.toISOString()}`);
  }
  return response;
}

export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failure: unknown;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed && next < items.length) {
        const index = next++;
        try {
          assertScrapeActive();
          results[index] = await work(items[index], index);
        } catch (error) {
          failed = true;
          failure = error;
        }
      }
    })
  );
  // Wait for already-started operations before propagating failure.
  if (failed) throw failure;
  return results;
}

export function mapScraperItems<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>
) {
  return getScrapeRuntime()
    ? mapConcurrent(items, 4, work)
    : Promise.all(items.map(work));
}

export function mapSettledScraperItems<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>
) {
  return getScrapeRuntime()
    ? mapConcurrent(items, 4, work)
    : Promise.allSettled(items.map(work));
}
