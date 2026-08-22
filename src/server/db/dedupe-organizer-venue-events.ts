import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

function argumentValue(name: string): string | undefined {
  const inline = process.argv.find((argument) =>
    argument.startsWith(`--${name}=`)
  );
  if (inline) return inline.slice(inline.indexOf("=") + 1);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type ScrapedEvent = {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  sourceImageUrl: string | null;
  eventUrl: string | null;
  source: string;
  externalId: string | null;
  startAt: Date;
  endAt: Date | null;
  venueId: string;
  organizerId: string | null;
  createdAt: Date;
};

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
  const { and, eq, inArray, isNotNull } = operators;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const rows = (await db.query.events.findMany({
      where: and(
        inArray(schema.events.source, ["dice", "posh", "ticketmaster"]),
        isNotNull(schema.events.venueId)
      ),
      columns: {
        id: true,
        title: true,
        description: true,
        coverImageUrl: true,
        sourceImageUrl: true,
        eventUrl: true,
        source: true,
        externalId: true,
        startAt: true,
        endAt: true,
        venueId: true,
        organizerId: true,
        createdAt: true,
      },
      orderBy: (event, { asc }) => [asc(event.createdAt), asc(event.id)],
    })) as ScrapedEvent[];

    const eventsBySlot = new Map<string, ScrapedEvent[]>();
    for (const event of rows) {
      const key = `${event.venueId}::${event.startAt.toISOString()}::${event.endAt?.toISOString() ?? "no-end"}`;
      const group = eventsBySlot.get(key) ?? [];
      group.push(event);
      eventsBySlot.set(key, group);
    }

    const duplicateGroups = Array.from(eventsBySlot.values()).filter(
      (group) =>
        group.length > 1 &&
        group.some((event) => event.organizerId) &&
        group.some((event) => !event.organizerId)
    );
    const duplicateCount = duplicateGroups.reduce(
      (count, group) => count + group.length - 1,
      0
    );

    console.log(
      `${apply ? "Repairing" : "Dry run:"} ${duplicateCount} organizer/venue duplicate(s) in ${duplicateGroups.length} group(s) on ${environment}`
    );

    for (const group of duplicateGroups) {
      const organizerEvents = group.filter((event) => event.organizerId);
      const keeper = organizerEvents[0];
      const preferred = organizerEvents[organizerEvents.length - 1];
      const duplicates = group.filter((event) => event.id !== keeper.id);
      const duplicateIds = duplicates.map((event) => event.id);

      console.log(
        `\n${group[0].startAt.toISOString()} → ${group[0].endAt?.toISOString() ?? "no end time"}`
      );
      for (const event of group) {
        console.log(
          `  ${event.id === keeper.id ? "KEEP organizer" : event.organizerId ? "MERGE organizer" : "DELETE venue"}: [${event.source}] ${event.createdAt.toISOString()} — ${event.title} — ${event.id}`
        );
      }
      console.log(`  preferred URL: ${preferred.eventUrl ?? "unchanged"}`);

      if (!apply) continue;

      await db.transaction(async (tx) => {
        const [categoryLinks, keeperRsvps, keeperReviews] = await Promise.all([
          tx.query.eventCategories.findMany({
            where: inArray(schema.eventCategories.eventId, duplicateIds),
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

        if (categoryLinks.length > 0) {
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
        if (keeperRsvpUsers.length > 0) {
          await tx
            .delete(schema.eventRsvps)
            .where(
              and(
                inArray(schema.eventRsvps.eventId, duplicateIds),
                inArray(schema.eventRsvps.userId, keeperRsvpUsers)
              )
            );
        }
        await tx
          .update(schema.eventRsvps)
          .set({ eventId: keeper.id })
          .where(inArray(schema.eventRsvps.eventId, duplicateIds));

        const keeperReviewUsers = keeperReviews.map(({ userId }) => userId);
        if (keeperReviewUsers.length > 0) {
          await tx
            .delete(schema.eventReviews)
            .where(
              and(
                inArray(schema.eventReviews.eventId, duplicateIds),
                inArray(schema.eventReviews.userId, keeperReviewUsers)
              )
            );
        }
        await tx
          .update(schema.eventReviews)
          .set({ eventId: keeper.id })
          .where(inArray(schema.eventReviews.eventId, duplicateIds));

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

        await tx
          .delete(schema.events)
          .where(inArray(schema.events.id, duplicateIds));
        await tx
          .update(schema.events)
          .set({
            title: preferred.title,
            description: preferred.description,
            coverImageUrl: preferred.coverImageUrl,
            sourceImageUrl: preferred.sourceImageUrl,
            eventUrl: preferred.eventUrl,
            source: preferred.source,
            externalId: preferred.externalId,
            endAt: preferred.endAt,
            venueId: preferred.venueId,
            organizerId: preferred.organizerId,
            updatedAt: new Date(),
          })
          .where(eq(schema.events.id, keeper.id));
      });
    }

    console.log(
      apply
        ? `\nComplete: deleted ${duplicateCount} duplicate(s) and retained ${duplicateGroups.length} organizer event(s).`
        : "\nNo changes made. Review the groups above, then re-run with --apply."
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Failed to deduplicate organizer/venue events:", error);
  process.exitCode = 1;
});
