import * as dotenv from "dotenv";
import * as cheerio from "cheerio";

dotenv.config({ path: ".env.local" });

function argumentValue(name: string): string | undefined {
  const inline = process.argv.find((argument) =>
    argument.startsWith(`--${name}=`)
  );
  if (inline) return inline.slice(inline.indexOf("=") + 1);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type DiceEvent = {
  id: string;
  title: string;
  description: string | null;
  eventUrl: string | null;
  externalId: string | null;
  startAt: Date;
  venueId: string | null;
  organizerId: string | null;
  address: string | null;
  city: string;
  state: string;
  createdAt: Date;
};

function canonicalDiceId(value: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (/^[a-f0-9]{24}$/i.test(trimmed)) return trimmed.toLowerCase();

  try {
    const pathname = new URL(trimmed).pathname.replace(/\/+$/, "");
    return (
      pathname.match(/^\/event\/([a-f0-9]{24})$/i)?.[1].toLowerCase() ?? null
    );
  } catch {
    return null;
  }
}

async function fetchCanonicalDiceId(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;

    const $ = cheerio.load(await response.text());
    return canonicalDiceId(
      $('meta[property="product:retailer_item_id"]').attr("content") ?? null
    );
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function main() {
  const environment = argumentValue("environment");
  const apply = process.argv.includes("--apply");

  if (environment !== "production" && environment !== "development") {
    throw new Error(
      "Pass --environment production or --environment development"
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  Object.assign(process.env, { NODE_ENV: environment });

  const [{ Pool }, { drizzle }, operators, schema] = await Promise.all([
    import("@neondatabase/serverless"),
    import("drizzle-orm/neon-serverless"),
    import("drizzle-orm"),
    import("./schema"),
  ]);
  const { and, eq, inArray } = operators;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const diceEvents = (await db.query.events.findMany({
      where: eq(schema.events.source, "dice"),
      columns: {
        id: true,
        title: true,
        description: true,
        eventUrl: true,
        externalId: true,
        startAt: true,
        venueId: true,
        organizerId: true,
        address: true,
        city: true,
        state: true,
        createdAt: true,
      },
      orderBy: (event, { asc }) => [asc(event.createdAt), asc(event.id)],
    })) as DiceEvent[];

    const canonicalIdByUrl = new Map<string, Promise<string | null>>();
    const resolvedEvents = await mapWithConcurrency(
      diceEvents,
      6,
      async (event) => {
        let canonicalId =
          canonicalDiceId(event.externalId) ?? canonicalDiceId(event.eventUrl);
        if (!canonicalId && event.eventUrl) {
          let request = canonicalIdByUrl.get(event.eventUrl);
          if (!request) {
            request = fetchCanonicalDiceId(event.eventUrl);
            canonicalIdByUrl.set(event.eventUrl, request);
          }
          canonicalId = await request;
        }
        return { event, canonicalId };
      }
    );

    const unresolved = resolvedEvents.filter(({ canonicalId }) => !canonicalId);
    const effectiveCanonicalId = new Map(
      resolvedEvents
        .filter(
          (resolved): resolved is { event: DiceEvent; canonicalId: string } =>
            Boolean(resolved.canonicalId)
        )
        .map(({ event, canonicalId }) => [event.id, canonicalId])
    );

    const eventsByVenueSlot = new Map<
      string,
      { event: DiceEvent; canonicalId: string }[]
    >();
    for (const resolved of resolvedEvents) {
      if (!resolved.canonicalId || !resolved.event.venueId) continue;
      const slot = `${resolved.event.venueId}::${resolved.event.startAt.toISOString()}`;
      const eventsInSlot = eventsByVenueSlot.get(slot) ?? [];
      eventsInSlot.push({
        event: resolved.event,
        canonicalId: resolved.canonicalId,
      });
      eventsByVenueSlot.set(slot, eventsInSlot);
    }

    for (const eventsInSlot of eventsByVenueSlot.values()) {
      const organizerEvent = eventsInSlot.find(
        ({ event }) => event.organizerId
      );
      const venueEvent = eventsInSlot.find(({ event }) => !event.organizerId);
      if (!organizerEvent || !venueEvent) continue;

      // Separate Dice listings can represent the same real-world event. An
      // exact venue/time collision across organizer and venue imports is the
      // conservative fallback, and adopts the organizer's canonical Dice ID.
      for (const { event } of eventsInSlot) {
        effectiveCanonicalId.set(event.id, organizerEvent.canonicalId);
      }
    }

    const grouped = new Map<string, DiceEvent[]>();
    for (const { event, canonicalId } of resolvedEvents) {
      if (!canonicalId) continue;
      const key = effectiveCanonicalId.get(event.id) ?? canonicalId;
      const group = grouped.get(key) ?? [];
      group.push(event);
      grouped.set(key, group);
    }

    const repairGroups = Array.from(grouped.entries()).filter(
      ([canonicalId, group]) =>
        group.length > 1 || group[0].externalId !== canonicalId
    );
    const duplicateCount = repairGroups.reduce(
      (total, [, group]) => total + group.length - 1,
      0
    );
    const identityUpdateCount = repairGroups.length;

    console.log(
      `${apply ? "Repairing" : "Dry run:"} ${duplicateCount} duplicate Dice event(s) and ${identityUpdateCount} canonical identity update(s) on ${environment}`
    );
    if (unresolved.length > 0) {
      console.log(
        `Skipping ${unresolved.length} event(s) whose canonical Dice ID could not be resolved.`
      );
    }

    for (const [canonicalId, group] of repairGroups) {
      const keeper = group.find((event) => event.organizerId) ?? group[0];
      const duplicates = group.filter((event) => event.id !== keeper.id);
      const duplicateIds = duplicates.map((event) => event.id);
      const editorialSource =
        [...group].reverse().find((event) => event.organizerId) ??
        [...group].reverse().find((event) => event.eventUrl) ??
        group[group.length - 1];

      console.log(`\n${keeper.title} — ${keeper.startAt.toISOString()}`);
      console.log(
        `  keep:   ${keeper.id} (${keeper.createdAt.toISOString()})${keeper.organizerId ? " [organizer]" : ""}`
      );
      for (const duplicate of duplicates) {
        console.log(
          `  delete: ${duplicate.id} (${duplicate.createdAt.toISOString()})${duplicate.organizerId ? " [organizer]" : ""} — ${duplicate.title}`
        );
      }
      console.log(`  canonical Dice ID: ${canonicalId}`);
      console.log(
        `  preferred event data: ${editorialSource.createdAt.toISOString()} — ${editorialSource.eventUrl ?? "unchanged"}`
      );

      if (!apply) continue;

      await db.transaction(async (tx) => {
        const [categoryLinks, keeperRsvps, keeperReviews] = await Promise.all([
          tx.query.eventCategories.findMany({
            where:
              duplicateIds.length > 0
                ? inArray(schema.eventCategories.eventId, duplicateIds)
                : eq(schema.eventCategories.eventId, keeper.id),
            columns: { categoryId: true },
          }),
          tx.query.eventRsvps.findMany({
            where: eq(schema.eventRsvps.eventId, keeper.id),
            columns: { userId: true },
          }),
          tx.query.eventReviews.findMany({
            where: eq(schema.eventReviews.eventId, keeper.id),
            columns: { userId: true },
          }),
        ]);

        if (duplicateIds.length > 0 && categoryLinks.length > 0) {
          await tx
            .insert(schema.eventCategories)
            .values(
              categoryLinks.map(({ categoryId }) => ({
                eventId: keeper.id,
                categoryId,
              }))
            )
            .onConflictDoNothing();
        }

        const keeperRsvpUsers = keeperRsvps.map(({ userId }) => userId);
        if (duplicateIds.length > 0 && keeperRsvpUsers.length > 0) {
          await tx
            .delete(schema.eventRsvps)
            .where(
              and(
                inArray(schema.eventRsvps.eventId, duplicateIds),
                inArray(schema.eventRsvps.userId, keeperRsvpUsers)
              )
            );
        }
        if (duplicateIds.length > 0) {
          await tx
            .update(schema.eventRsvps)
            .set({ eventId: keeper.id })
            .where(inArray(schema.eventRsvps.eventId, duplicateIds));
        }

        const keeperReviewUsers = keeperReviews.map(({ userId }) => userId);
        if (duplicateIds.length > 0 && keeperReviewUsers.length > 0) {
          await tx
            .delete(schema.eventReviews)
            .where(
              and(
                inArray(schema.eventReviews.eventId, duplicateIds),
                inArray(schema.eventReviews.userId, keeperReviewUsers)
              )
            );
        }
        if (duplicateIds.length > 0) {
          await tx
            .update(schema.eventReviews)
            .set({ eventId: keeper.id })
            .where(inArray(schema.eventReviews.eventId, duplicateIds));
        }

        if (duplicateIds.length > 0)
          await Promise.all([
            tx
              .update(schema.eventActivity)
              .set({ eventId: keeper.id })
              .where(inArray(schema.eventActivity.eventId, duplicateIds)),
            tx
              .update(schema.userActivity)
              .set({ entityId: keeper.id })
              .where(
                and(
                  eq(schema.userActivity.entityType, "event"),
                  inArray(schema.userActivity.entityId, duplicateIds)
                )
              ),
            tx
              .update(schema.notifications)
              .set({ entityId: keeper.id })
              .where(
                and(
                  eq(schema.notifications.entityType, "event"),
                  inArray(schema.notifications.entityId, duplicateIds)
                )
              ),
          ]);

        if (duplicateIds.length > 0) {
          await tx
            .delete(schema.events)
            .where(inArray(schema.events.id, duplicateIds));
        }
        await tx
          .update(schema.events)
          .set({
            title: editorialSource.title,
            eventUrl: editorialSource.eventUrl ?? keeper.eventUrl,
            externalId: canonicalId,
            description: editorialSource.description ?? keeper.description,
            venueId: editorialSource.venueId ?? keeper.venueId,
            organizerId: editorialSource.organizerId ?? keeper.organizerId,
            updatedAt: new Date(),
          })
          .where(eq(schema.events.id, keeper.id));
      });
    }

    console.log(
      apply
        ? `\nComplete: deleted ${duplicateCount} duplicate(s) and updated ${identityUpdateCount} canonical Dice identity record(s).`
        : "\nNo changes made. Review the groups above, then re-run with --apply."
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Failed to deduplicate Dice events:", error);
  process.exitCode = 1;
});
