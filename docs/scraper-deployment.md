# Batch scraper deployment and rollback

The batch runner is implemented on branch `codex/scraper-batch-runner`. Production changes require the additive migration and a deployment. The existing provider schedules and legacy runner remain available.

## Select the active runner

Set `SCRAPER_RUNNER_MODE` in the Vercel environment used by the deployment:

| Value | Behavior |
| --- | --- |
| `batch` | `/api/cron/run-scrapers` checks for up to ten due configurations every five minutes; legacy provider endpoints skip work |
| `legacy` | Existing daily provider endpoints run; the batch endpoint skips work |
| `off` | Both scheduled scraper systems skip work |

An unset variable defaults to `batch`. Unknown/empty values behave as `off`. Changing a Vercel environment variable requires redeployment. Keep `CRON_SECRET` configured: both systems reject requests without the correct bearer secret. `POSH_CRON_ENABLED=true` remains necessary for scheduled Posh imports.

Both systems use the same global lock. A lock lasts ten minutes and is released after a normal run; expiry recovers it after a stopped function. New invocations cannot overlap an already-running batch/legacy invocation. The existing recurring-event-series cron is independent of this setting.

## First deployment

1. Confirm which database and Vercel project serve production. Review the normal migration ledger so unrelated pending migrations are understood.
2. Apply migration `0077_scraper_batch_runner` using the existing migration process (`pnpm db:migrate`). It adds four columns to `scrapers`, a small lock/cooldown table, and indexes. Existing event data and scraper configurations remain intact. This must happen before the new application code serves database queries.
3. Configure `SCRAPER_RUNNER_MODE=off` and deploy this code. A previous deployment can have an old scraper invocation still running; allow its full five-minute budget to elapse before activation. The original deployment does not understand the new switch or lock.
4. Set `SCRAPER_RUNNER_MODE=batch` and redeploy. Verify the next five-minute cron response and the admin Scrapers screen. The old daily cron entries remain scheduled but now return `skipped` before doing work.
5. Confirm success timestamps advance, due configurations drain, and individual failures receive a later retry. Start with a small eligible set before expanding places. Disabled places and opted-out Posh configurations are excluded.

All configurations are initially due after migration. Subsequent successful event imports become due 24 hours after completion. Newly created configurations are due immediately. Saving a configuration resets its schedule; an older in-flight attempt cannot mark an edited configuration successful.

## Rollback

Set `SCRAPER_RUNNER_MODE=legacy` and redeploy the same code. The retained daily schedules become active, and the batch endpoint stops starting work. An in-flight batch keeps its lock until it finishes; after a host termination, allow the ten-minute lock expiry. A legacy trigger that arrives while the lock is held skips that invocation, so verify it ran rather than assuming a missed daily trigger will retry itself.

If an immediate refresh is needed after the lock is clear, invoke the existing authenticated `/api/cron/run-scrapers/dice`, `/posh`, `/ticketmaster`, or `/eventbrite` endpoint once, with the configured cron secret. Otherwise, the original daily schedules resume normally.

There is no database rollback: leave the added columns and table in place. Switching modes changes scheduled execution, not the parser/importer version or already-imported events. The Posh location fix and shared image-upload cancellation improvements remain in both modes.

For a fully paused transition, deploy `off`, let in-flight work finish, then deploy the desired mode. Do not remove an active lock manually.

## Operating behavior

- One serial batch attempts at most ten configurations and stops starting new work after three minutes. Each attempt has a 90-second cancellation signal; HTTP requests, finite database waits, bounded concurrency, and a separate 15-second current-image budget keep work bounded within the five-minute function limit.
- Before fetching, the runner saves the attempt and its retry time. Interrupted/failed attempts retry after 30 minutes, two hours, six hours, then daily. A successful event import resets the count. Provider `Retry-After` cooldowns are shared across future batches through the lock table.
- Successful configurations are skipped until due. Incomplete listings never advance `lastSuccessAt`. A valid empty listing can succeed. Image failures are warnings, independent of event freshness.
- New scheduling does not scan historical events for image repair. Current-source images can retry on a later scrape; historical repair remains an explicit maintenance action.
- The existing admin Scrapers page shows the selected runner, last attempt, last success, next run, freshness, and latest error. These health fields describe scheduled batch imports, not manual preview/import actions.

## Validation

Run `pnpm test:scrapers` for cancellation, cooldown, concurrency, provider pagination, location fallback, and mode/authentication checks. Run `pnpm exec tsc --noEmit --incremental false` and `pnpm build` for application checks.

The opt-in `src/server/scrapers/batch.integration.test.ts` additionally exercises the real migration, 100-configuration batches, lock contention/expiry, interruption recovery, failure isolation, stale configuration completion, partial imports, category repair, image warnings, and rollback guards. It refuses to reset any database except a localhost database named `wig_scraper_test`.

For that integration test, supply:

- `SCRAPER_TEST_DATABASE_URL`: disposable localhost PostgreSQL URL ending in `/wig_scraper_test`.
- `SCRAPER_TEST_SCHEMA_PATH`: SQL generated from the current schema with `pnpm exec drizzle-kit export --dialect postgresql --schema ./src/server/db/schema.ts` (redirect its output to a temporary file).
- `SCRAPER_TEST_PG_MODULE`: path to a temporary installation of the `pg` test driver. Add that installation's `node_modules` to `NODE_PATH` so Drizzle's test-only Node/Postgres adapter can resolve it. No production dependency changes are needed.
- `DOTENV_CONFIG_PATH=.env.local` for image-storage configuration. Override `DATABASE_URL` with the disposable local URL; the application database must not be the test target.

Then run `pnpm test:scrapers:integration`. Its setup resets only the disposable local schema and reconstructs a pre-migration scraper row to verify the additive migration preserves it. All provider HTTP requests are mocked. This is a correctness rehearsal, not a live-site throughput benchmark.

Validation completed locally: 10 runtime/provider tests, 11 PostgreSQL integration tests, and a production build with `pnpm exec next build --webpack`. Turbopack's local build worker could not bind its internal port in this environment.

The build also required moving provider helpers out of route exports, correcting two existing page search-parameter types, and retaining the obsolete duplicate root calendar as `src/app/(main)/legacy-calendar.tsx`. The intended landing page at `/` and app page at `/home` now build without the previous root-route collision.
