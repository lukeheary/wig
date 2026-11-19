# Simple scraper reliability plan

Revised November 18, 2026. Vercel Pro confirmed.

## Goal

Reliably refresh 50–100 scraper configurations daily, with room to grow, using the existing Next.js, Vercel, Neon, Drizzle, S3, and Sharp stack. A configuration is one scraper attached to a place; a place may have more than one.

Use small resumable batches and the existing scraper rows to remember what is due. This replaces the earlier general-purpose queue proposal. The implementation is now available locally; see [deployment and rollback instructions](scraper-deployment.md). Production migration and deployment are separate steps.

## The flow

```mermaid
flowchart LR
    A[Cron every five minutes] --> B[Acquire runner lock]
    B --> C[Select up to ten due scrapers]
    C --> D[Run one at a time]
    D --> E[Save outcome and next run time]
    E --> F[Later cron picks up remaining work]
```

A cron waking every five minutes does not scrape every place that often. Each successful configuration becomes due again 24 hours later. Failures become due sooner for a retry. Schedule from completion initially; precise city-local refresh windows are unnecessary for this version.

## 1. Make the current runner process a small batch

Replace the four provider-wide daily scraper triggers with one `/api/cron/run-scrapers` trigger every five minutes. Keep the recurring-event-series cron as it is.

Move the current `runScraper` function into a reusable server module, with the smallest changes needed for batch execution. Keep provider parsers, current reconciliation rules, and manual preview/import interfaces. Consolidating every mobile/web import path is outside this version.

Select eligible configurations by `nextRunAt`, then ID, and process them sequentially across providers. Start with a maximum of ten per invocation. Skip disabled places and preserve the existing Posh opt-in switch.

Keep the five-minute function limit. Stop starting another scraper after three minutes. Give each scraper an overall target budget of 90 seconds, including fetch/import/image work, leaving time to save state before the platform cutoff. Propagate cancellation to actual fetches and bound database/image operations; a detached `Promise.race` must not leave timed-out work running in the background. If an individual source repeatedly cannot fit, surface it as a capacity exception rather than silently reporting success.

## 2. Save a little progress on existing rows

Add four scheduling fields to `scrapers` in one additive Drizzle migration:

| Field | Purpose |
| --- | --- |
| `nextRunAt` | When this configuration is eligible |
| `lastAttemptAt` | Whether it was actually attempted, even if the function stopped |
| `lastSuccessAt` | Last complete successful event import |
| `attemptsSinceSuccess` | Backoff after unsuccessful or interrupted attempts |

Before running a configuration, atomically record the attempt, increment its attempt count, and advance its next eligible time to a retry time. Success then records `lastSuccessAt`, resets the count, and sets the next run to 24 hours later. A crash leaves the configuration eligible for a later retry instead of losing it or restarting the entire catalog.

Start with retry delays of 30 minutes, two hours, six hours, then once a day. Honor a longer provider `Retry-After`. A broken configuration cannot monopolize every batch because it is moved out of the due set before its work begins. Successfully imported configurations are skipped on subsequent ticks.

Initialize existing configurations as due and give new configurations a due time. Index `nextRunAt`. Continue using `scraper_logs` for results, durations, and errors; add its existing admin query an appropriate time index.

## 3. Prevent overlap and contain failures

Add one tiny `scraper_runner_lock` table with one global row containing a token and expiry. Acquire it with an atomic database operation; return promptly if another runner owns it. Release in `finally`, conditional on the token matching.

Use a ten-minute expiry, longer than the five-minute function maximum, so an abandoned lock clears automatically and a valid invocation cannot outlive its lock. This is one batch lock, not a worker/lease framework. Do not hold a database transaction open during scraping. Cron routes must require the configured secret.

Wrap each entire scraper attempt in its own error boundary, including import and log failures. Save scheduling state independently of a successful log write. A failure in one venue should not abort the other due venues. Report incomplete fetches/imports as partial or failed; a valid empty listing can succeed.

Retain conservative provider pacing and add modest limits to detail fetches and database/image bursts. Process scheduled scrapers serially. On 429 responses, respect cooldown and defer the affected provider for the remainder of the batch; future ticks should consult the recent recorded cooldown. No distributed request-permit system is needed for this scope.

Keep the existing source/external-ID uniqueness protection. Make the scheduled import retry repair category/link work for existing events as well as newly inserted events, so a partially completed attempt can finish on retry. Avoid a source-identity or editorial-ownership redesign in this change.

## 4. Remove unnecessary work and expose basic health

Remove `rehostExistingScrapedEventImages` from scheduled scraper startup. Historical image repair becomes an explicit, bounded maintenance action when needed.

Keep current-result image hosting in the scraper for now, with at most two concurrent image operations and a bounded share of the attempt budget. Save events first. Failed/deferred images appear as warnings and can be retried on a later scrape while the source still returns the event. They do not invalidate an otherwise complete event import. This intentionally provides no independent image retry guarantee after an event disappears from the source; revisit it if that becomes a practical issue.

Extend the existing scraper admin view with last attempt, last successful import, next run, and latest error. Mark a daily scraper overdue after roughly 26 hours without complete success, and identify never-successful configurations separately. Reuse the existing UI and logs.

Fix the concrete multi-city blocker: remove Posh's Boston/MA defaults and use trustworthy event/venue data. Detect provider truncation now: Ticketmaster should follow available pages within the attempt budget, and Eventbrite must report when more pages remain at its cap. A listing that exceeds the budget is visibly incomplete and does not advance `lastSuccessAt`. General resumable pagination and large-source workflows can wait until an actual source needs them.

## Delivery and verification

1. **Batching and recovery:** production-health check, four scheduling fields, the one-row lock, serial batch runner, per-attempt error handling, and the new cron.
2. **Runtime and basic health:** remove historical image scans, bound detail/image work, repair partial-import retries, remove location defaults, expose truncation, and add freshness fields to the existing admin screen.

Test migrations on an isolated database branch. Use recorded responses and 100 synthetic configurations to verify batching, retry backoff, duplicate triggers, lock expiry, interruption after an attempt starts, category/link repair, disabled places, and one failing scraper among healthy ones. Then canary the new runner against a small live subset within provider quotas.

Guard both old and new runners during cutover. Stop legacy dispatch, wait for any old invocation to finish or its five-minute budget to expire, then enable the batch runner. Keep a simple off switch for rollback; additive scheduling fields can stay in place.

The initial throughput target is to finish 100 ordinary configurations in roughly one to two hours of being due. Ten configurations per five-minute tick would need about 50 minutes for 100 when attempts fit comfortably; slow sources, provider cooldowns, and missed ticks increase that time. This is a target to verify, not a benchmark result.

Reconsider the design when healthy due work regularly takes several hours, one source repeatedly exceeds the per-attempt budget, or image failures require independent recovery. General job tables, child workflows, additional services, source-link migrations, and a new dashboard are deferred until those needs appear.
