import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  places,
  scraperLogs,
  scraperRunnerLock,
  scrapers,
  users,
} from "@/server/db/schema";
import { LOCK_DURATION_MS, retryDelayMs, type ScraperType } from "./policy";

export function createScraperStore(database: typeof db) {
  return {
    async acquireLock() {
      const token = randomUUID();
      const [row] = await database
        .insert(scraperRunnerLock)
        .values({
          id: "global",
          token,
          lockedUntil: sql`now() + ${LOCK_DURATION_MS} * interval '1 millisecond'`,
        })
        .onConflictDoUpdate({
          target: scraperRunnerLock.id,
          set: {
            token,
            lockedUntil: sql`now() + ${LOCK_DURATION_MS} * interval '1 millisecond'`,
          },
          setWhere: sql`${scraperRunnerLock.lockedUntil} <= now()`,
        })
        .returning({ token: scraperRunnerLock.token });
      return row?.token ?? null;
    },
    async releaseLock(token: string) {
      await database
        .update(scraperRunnerLock)
        .set({ lockedUntil: new Date(0) })
        .where(
          and(
            eq(scraperRunnerLock.id, "global"),
            eq(scraperRunnerLock.token, token)
          )
        );
    },
    async cooldowns() {
      const [row] = await database
        .select({ cooldowns: scraperRunnerLock.cooldowns })
        .from(scraperRunnerLock)
        .where(eq(scraperRunnerLock.id, "global"));
      return row?.cooldowns ?? {};
    },
    async setCooldown(provider: ScraperType, until: Date) {
      await database
        .update(scraperRunnerLock)
        .set({
          cooldowns: sql`jsonb_set(${scraperRunnerLock.cooldowns}, array[${provider}::text], to_jsonb(${until.toISOString()}::text), true)`,
        })
        .where(eq(scraperRunnerLock.id, "global"));
    },
    async adminId() {
      const [admin] = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "admin"))
        .orderBy(asc(users.id))
        .limit(1);
      if (!admin) throw new Error("No admin user found to attribute events to");
      return admin.id;
    },
    async due(providers: ScraperType[], now: Date, limit: number) {
      if (!providers.length) return [];
      return database.query.scrapers.findMany({
        where: and(
          lte(scrapers.nextRunAt, now),
          inArray(scrapers.scraper, providers),
          inArray(
            scrapers.placeId,
            database
              .select({ id: places.id })
              .from(places)
              .where(eq(places.isEnabled, true))
          )
        ),
        with: { place: true },
        orderBy: [asc(scrapers.nextRunAt), asc(scrapers.id)],
        limit,
      });
    },
    async markAttempt(
      id: string,
      now: Date,
      expected?: {
        scraper: ScraperType;
        searchString: string;
        classificationName: string | null;
        placeId: string;
      }
    ) {
      // Persist the retry before starting work, including attempts that are killed by the host.
      const [row] = await database
        .update(scrapers)
        .set({
          lastAttemptAt: now,
          attemptsSinceSuccess: sql`${scrapers.attemptsSinceSuccess} + 1`,
          nextRunAt: sql`${now.toISOString()}::timestamptz + case
          when ${scrapers.attemptsSinceSuccess} = 0 then interval '30 minutes'
          when ${scrapers.attemptsSinceSuccess} = 1 then interval '2 hours'
          when ${scrapers.attemptsSinceSuccess} = 2 then interval '6 hours'
          else interval '24 hours' end`,
        })
        .where(
          and(
            eq(scrapers.id, id),
            lte(scrapers.nextRunAt, now),
            expected
              ? and(
                  eq(scrapers.scraper, expected.scraper),
                  eq(scrapers.searchString, expected.searchString),
                  eq(scrapers.placeId, expected.placeId),
                  expected.classificationName === null
                    ? isNull(scrapers.classificationName)
                    : eq(
                        scrapers.classificationName,
                        expected.classificationName
                      )
                )
              : undefined,
            inArray(
              scrapers.placeId,
              database
                .select({ id: places.id })
                .from(places)
                .where(eq(places.isEnabled, true))
            )
          )
        )
        .returning({ attempts: scrapers.attemptsSinceSuccess });
      return row?.attempts ?? null;
    },
    async succeeded(id: string, now: Date, attemptedAt: Date) {
      await database
        .update(scrapers)
        .set({
          lastSuccessAt: now,
          attemptsSinceSuccess: 0,
          nextRunAt: new Date(now.getTime() + 24 * 60 * 60_000),
        })
        .where(
          and(eq(scrapers.id, id), eq(scrapers.lastAttemptAt, attemptedAt))
        );
    },
    async defer(
      id: string,
      attempts: number,
      now: Date,
      cooldown: Date,
      attemptedAt: Date
    ) {
      await database
        .update(scrapers)
        .set({
          nextRunAt: new Date(
            Math.max(now.getTime() + retryDelayMs(attempts), cooldown.getTime())
          ),
        })
        .where(
          and(eq(scrapers.id, id), eq(scrapers.lastAttemptAt, attemptedAt))
        );
    },
    async log(value: typeof scraperLogs.$inferInsert) {
      await database.insert(scraperLogs).values(value);
    },
  };
}

export const scraperStore = createScraperStore(db);
export type ScraperStore = ReturnType<typeof createScraperStore>;
export type DueScraper = Awaited<ReturnType<ScraperStore["due"]>>[number];
