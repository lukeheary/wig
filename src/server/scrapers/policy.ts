export const SCRAPER_TYPES = [
  "dice",
  "posh",
  "ticketmaster",
  "eventbrite",
] as const;
export type ScraperType = (typeof SCRAPER_TYPES)[number];
export type RunnerMode = "batch" | "legacy" | "off";
export const BATCH_SIZE = 10;
export const START_WORK_BUDGET_MS = 180_000;
export const ATTEMPT_BUDGET_MS = 90_000;
export const LOCK_DURATION_MS = 600_000;

export function runnerMode(
  value = process.env.SCRAPER_RUNNER_MODE
): RunnerMode {
  if (value === undefined) return "batch";
  return value === "batch" || value === "legacy" ? value : "off";
}

export function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`
  );
}

export function retryDelayMs(attempts: number) {
  return [30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000][
    Math.min(3, Math.max(0, attempts - 1))
  ];
}

export function scraperFreshness(lastSuccessAt: Date | null, now = new Date()) {
  if (!lastSuccessAt) return "never";
  return now.getTime() - lastSuccessAt.getTime() > 26 * 60 * 60_000
    ? "overdue"
    : "healthy";
}

export function resetScraperSchedule() {
  return {
    nextRunAt: new Date(),
    lastAttemptAt: null,
    lastSuccessAt: null,
    attemptsSinceSuccess: 0,
  };
}
