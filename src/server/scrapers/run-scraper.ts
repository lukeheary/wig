import { db as defaultDb } from "@/server/db";
import { generateNanoId } from "@/lib/nano-id";
import { events, places, eventCategories } from "@/server/db/schema";
import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import {
  filterExistingCategoryKeys,
  setEventCategoryKeys,
} from "@/server/utils/categories";
import { scrapeDice } from "@/server/scrapers/providers/dice";
import { scrapePosh } from "@/server/scrapers/providers/posh";
import { scrapeTicketmaster } from "@/server/scrapers/providers/ticketmaster";
import { scrapeEventbrite } from "@/server/scrapers/providers/eventbrite";
import { rehostScrapedEventImage } from "@/server/utils/scraped-event-images";
import { claimManualSeriesOccurrence } from "@/server/utils/scraper-event-reconciliation";
import {
  assertScrapeActive,
  getScrapeRuntime,
  mapConcurrent,
  mapScraperItems,
  mapSettledScraperItems,
} from "./runtime";
interface ScrapedEvent {
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  eventUrl: string | null;
  externalId: string | null;
  startAt: string;
  endAt: string | null;
  timeZone?: string | null;
  venueName?: string;
  address?: string | null;
  city: string;
  state: string;
  categories: string[];
  visibility: "public";
  source: string;
}
export async function runScraper(
  scraperRow: {
    id: string;
    placeId: string;
    scraper: "dice" | "posh" | "ticketmaster" | "eventbrite";
    searchString: string;
    classificationName: string | null;
    place: {
      type: "venue" | "organizer";
      name: string;
      city: string | null;
      state: string | null;
      website: string | null;
    };
  },
  adminUserId: string,
  db: typeof defaultDb = defaultDb
): Promise<{
  status: "success" | "error" | "partial";
  eventsFound: number;
  eventsAdded: number;
  error: string | null;
  data: {
    eventsFound: {
      title: string;
      externalId: string | null;
    }[];
    eventsAdded: {
      id: string;
      title: string;
      externalId: string | null;
    }[];
  };
}> {
  let scrapeResult: {
    events: ScrapedEvent[];
    errors?: {
      url: string;
      error: string;
    }[];
    complete?: boolean;
  };
  try {
    if (scraperRow.scraper === "dice") {
      scrapeResult = await scrapeDice(scraperRow.searchString);
    } else if (scraperRow.scraper === "posh") {
      const urls = scraperRow.searchString
        .split(/[\n,]+/)
        .map((v) => v.trim())
        .filter(Boolean);
      if (urls.length === 0) {
        return {
          status: "error",
          eventsFound: 0,
          eventsAdded: 0,
          error: "Posh scraper has an empty search string",
          data: { eventsFound: [], eventsAdded: [] },
        };
      }
      scrapeResult = await scrapePosh(urls);
    } else if (scraperRow.scraper === "ticketmaster") {
      if (!scraperRow.place.state) {
        return {
          status: "error",
          eventsFound: 0,
          eventsAdded: 0,
          error: "Ticketmaster scraper requires venue to have a state code",
          data: { eventsFound: [], eventsAdded: [] },
        };
      }
      scrapeResult = await scrapeTicketmaster({
        venueName: scraperRow.searchString,
        stateCode: scraperRow.place.state,
        classificationName: scraperRow.classificationName ?? undefined,
      });
    } else if (scraperRow.scraper === "eventbrite") {
      scrapeResult = await scrapeEventbrite(scraperRow.searchString);
    } else {
      return {
        status: "error",
        eventsFound: 0,
        eventsAdded: 0,
        error: `Unknown scraper type: ${scraperRow.scraper}`,
        data: { eventsFound: [], eventsAdded: [] },
      };
    }
  } catch (err) {
    return {
      status: "error",
      eventsFound: 0,
      eventsAdded: 0,
      error: err instanceof Error ? err.message : "Scraper error",
      data: { eventsFound: [], eventsAdded: [] },
    };
  }
  assertScrapeActive();
  const scrapedEvents = scrapeResult.events ?? [];
  const eventsFoundData = scrapedEvents.map((e) => ({
    title: e.title,
    externalId: e.externalId,
  }));
  if (scrapedEvents.length === 0) {
    const scrapeErrors = scrapeResult.errors ?? [];
    return {
      status:
        scrapeErrors.length > 0
          ? "error"
          : getScrapeRuntime() &&
              (scrapeResult.complete === false ||
                getScrapeRuntime()?.incomplete)
            ? "partial"
            : "success",
      eventsFound: 0,
      eventsAdded: 0,
      error:
        scrapeErrors.length > 0
          ? scrapeErrors.map(({ url, error }) => `${url}: ${error}`).join("; ")
          : getScrapeRuntime() &&
              (scrapeResult.complete === false ||
                getScrapeRuntime()?.incomplete)
            ? "Provider listing is incomplete"
            : null,
      data: { eventsFound: [], eventsAdded: [] },
    };
  }
  const venueId =
    scraperRow.place.type === "venue" ? scraperRow.placeId : undefined;
  const organizerId =
    scraperRow.place.type === "organizer" ? scraperRow.placeId : undefined;
  const normalizeVenueName = (value: string | null | undefined) =>
    (value ?? "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const normalizeStreetAddress = (value: string | null | undefined) =>
    normalizeVenueName(value?.split(",")[0])
      .split(" ")
      .map(
        (word) =>
          ({
            avenue: "ave",
            boulevard: "blvd",
            circle: "cir",
            court: "ct",
            drive: "dr",
            highway: "hwy",
            lane: "ln",
            parkway: "pkwy",
            place: "pl",
            road: "rd",
            square: "sq",
            street: "st",
            terrace: "ter",
          })[word] ?? word
      )
      .join(" ");
  const organizerVenues = organizerId
    ? await db
        .select({
          id: places.id,
          name: places.name,
          aliases: places.aliases,
          city: places.city,
          state: places.state,
          address: places.address,
        })
        .from(places)
        .where(eq(places.type, "venue"))
    : [];
  const resolveOrganizerVenueId = (event: ScrapedEvent) => {
    const scrapedName = normalizeVenueName(event.venueName);
    if (!scrapedName && !normalizeStreetAddress(event.address)) return null;
    const matches = organizerVenues.filter((place) => {
      if (
        event.state &&
        place.state &&
        normalizeVenueName(event.state) !== normalizeVenueName(place.state)
      ) {
        return false;
      }
      return (
        [place.name, ...place.aliases].some(
          (name) => normalizeVenueName(name) === scrapedName
        ) ||
        (Boolean(normalizeStreetAddress(event.address)) &&
          normalizeStreetAddress(event.address) ===
            normalizeStreetAddress(place.address))
      );
    });
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) return null;
    if (
      !event.address ||
      normalizeVenueName(event.venueName) !== normalizeVenueName(event.address)
    ) {
      return null;
    }
    const organizerName = normalizeVenueName(scraperRow.place.name);
    const organizerAliasMatches = organizerVenues.filter((place) => {
      if (
        event.state &&
        place.state &&
        normalizeVenueName(event.state) !== normalizeVenueName(place.state)
      ) {
        return false;
      }
      return place.aliases.some(
        (alias) => normalizeVenueName(alias) === organizerName
      );
    });
    return organizerAliasMatches.length === 1
      ? organizerAliasMatches[0].id
      : null;
  };
  // Collect all category keys for batch validation
  const allCategoryKeys = Array.from(
    new Set(scrapedEvents.flatMap((e) => e.categories ?? []))
  );
  const validCategoryKeys = new Set(
    await filterExistingCategoryKeys(db, allCategoryKeys, { activeOnly: true })
  );
  const validScrapedValues = scrapedEvents
    .map((e) => ({
      publicId: generateNanoId(),
      title: e.title,
      description: e.description ?? null,
      coverImageUrl: e.coverImageUrl ?? null,
      eventUrl: e.eventUrl ?? scraperRow.place.website ?? null,
      source: e.source ?? null,
      externalId: e.externalId ?? null,
      startAt: new Date(e.startAt),
      timeZone: e.timeZone ?? null,
      endAt: e.endAt ? new Date(e.endAt) : null,
      address: e.address ?? null,
      categories: e.categories ?? [],
      city:
        e.city ||
        (venueId || !getScrapeRuntime() ? scraperRow.place.city : "") ||
        "",
      state:
        e.state ||
        (venueId || !getScrapeRuntime() ? scraperRow.place.state : "") ||
        "",
      venueId: venueId ?? resolveOrganizerVenueId(e),
      organizerId: organizerId ?? null,
      visibility: "public" as const,
      status: "active" as const,
      createdByUserId: adminUserId,
    }))
    .filter((v) => v.city && v.state);
  if (validScrapedValues.length === 0) {
    return {
      status: "partial",
      eventsFound: scrapedEvents.length,
      eventsAdded: 0,
      error: "All events missing city/state",
      data: { eventsFound: eventsFoundData, eventsAdded: [] },
    };
  }
  // Posh can return historical events. Never create a missing historical Posh
  // event, while still retaining it in `validScrapedValues` so an existing WIG
  // row can have its externally hosted image repaired below.
  const now = new Date();
  let insertValues = validScrapedValues.filter(
    (value) =>
      scraperRow.scraper !== "posh" || value.startAt.getTime() >= now.getTime()
  );
  // Reconcile separate organizer and venue listings by exact venue, start,
  // and end time, including when they came from different scraper sources.
  insertValues = await mapScraperItems(insertValues, async (value) => {
    if (!value.source || !value.venueId || !value.externalId) return value;
    const externalIdMatch = await db.query.events.findFirst({
      where: and(
        eq(events.source, value.source),
        eq(events.externalId, value.externalId)
      ),
      columns: { id: true },
    });
    if (externalIdMatch) return value;
    const sameSlot = await db.query.events.findFirst({
      where: and(
        eq(events.venueId, value.venueId),
        eq(events.startAt, value.startAt),
        value.endAt ? eq(events.endAt, value.endAt) : isNull(events.endAt)
      ),
      columns: { id: true, source: true, externalId: true },
      orderBy: (event, { asc }) => [asc(event.createdAt)],
    });
    if (!sameSlot?.externalId) {
      if (organizerId) {
        const claimedId = await claimManualSeriesOccurrence({
          db,
          venueId: value.venueId,
          source: value.source,
          externalId: value.externalId,
          startAt: value.startAt,
          title: value.title,
          description: value.description,
          coverImageUrl: value.coverImageUrl,
          eventUrl: value.eventUrl,
          timeZone: value.timeZone,
          endAt: value.endAt,
          address: value.address,
          city: value.city,
          state: value.state,
          organizerId,
        });
        if (claimedId && value.categories.length > 0) {
          const categoryKeys = await filterExistingCategoryKeys(
            db,
            value.categories,
            { activeOnly: true }
          );
          await setEventCategoryKeys(db, claimedId, categoryKeys, {
            activeOnly: true,
          });
        }
        if (claimedId && value.coverImageUrl && !getScrapeRuntime()) {
          await rehostScrapedEventImage(
            claimedId,
            value.coverImageUrl,
            value.coverImageUrl,
            value.coverImageUrl,
            { db }
          );
        }
      }
      return value;
    }
    if (sameSlot.externalId === value.externalId) {
      return value;
    }
    if (organizerId) {
      await db
        .update(events)
        .set({ source: value.source, externalId: value.externalId })
        .where(eq(events.id, sameSlot.id));
      return value;
    }
    return {
      ...value,
      source: sameSlot.source ?? value.source,
      externalId: sameSlot.externalId,
    };
  });
  let upserted: {
    id: string;
    title: string;
    source: string | null;
    externalId: string | null;
  }[] = [];
  if (insertValues.length > 0) {
    try {
      upserted = await db
        .insert(events)
        .values(insertValues as any)
        .onConflictDoNothing({ target: [events.source, events.externalId] })
        .returning({
          id: events.id,
          title: events.title,
          source: events.source,
          externalId: events.externalId,
        });
    } catch (err) {
      return {
        status: "error",
        eventsFound: scrapedEvents.length,
        eventsAdded: 0,
        error: err instanceof Error ? err.message : "DB insert error",
        data: { eventsFound: eventsFoundData, eventsAdded: [] },
      };
    }
  }
  // A scraper can discover a corrected location for an event we already have.
  // Keep the existing-event path out of `upserted` so it does not count as a
  // newly added event.
  await mapScraperItems(
    insertValues.filter((value) => value.source && value.externalId),
    async (value) => {
      const updates: Partial<{
        city: string;
        state: string;
        venueId: string | null;
        updatedAt: Date;
        timeZone: string | null;
      }> = {
        city: value.city,
        state: value.state,
        updatedAt: new Date(),
        timeZone: value.timeZone,
      };
      const locationMismatchConditions = [
        ne(events.city, value.city),
        ne(events.state, value.state),
      ];
      if (value.venueId) {
        updates.venueId = value.venueId;
        locationMismatchConditions.push(
          isNull(events.venueId),
          ne(events.venueId, value.venueId)
        );
      }
      await db
        .update(events)
        .set(updates)
        .where(
          and(
            eq(events.source, value.source!),
            eq(events.externalId, value.externalId!),
            or(...locationMismatchConditions)
          )
        );
    }
  );
  // If an event already existed, still enrich it with a venue/organizer link
  // when the scraper now knows that relationship and the stored row does not.
  if (venueId || organizerId || insertValues.some((value) => value.venueId)) {
    const linkableEvents = insertValues.filter(
      (value) => value.source && value.externalId
    );
    await mapSettledScraperItems(linkableEvents, async (value) => {
      const updates: Partial<{
        venueId: string | null;
        organizerId: string | null;
        title: string;
        description: string | null;
        eventUrl: string | null;
        endAt: Date | null;
        timeZone: string | null;
      }> = {};
      const missingLinkConditions = [];
      if (value.venueId) {
        updates.venueId = value.venueId;
        missingLinkConditions.push(isNull(events.venueId));
      }
      if (organizerId) {
        updates.organizerId = organizerId;
        missingLinkConditions.push(isNull(events.organizerId));
        // Prefer organizer editorial fields regardless of which scraper ran
        // first. The final update remains scoped to this source and ID.
        updates.title = value.title;
        updates.description = value.description;
        updates.eventUrl = value.eventUrl;
        updates.endAt = value.endAt;
        updates.timeZone = value.timeZone;
        missingLinkConditions.push(eq(events.source, value.source));
      }
      if (
        Object.keys(updates).length === 0 ||
        missingLinkConditions.length === 0
      ) {
        return;
      }
      await db
        .update(events)
        .set(updates)
        .where(
          and(
            eq(events.source, value.source!),
            eq(events.externalId, value.externalId!),
            or(...missingLinkConditions)
          )
        );
    });
  }
  // On batch retries, repair missing categories even when insertion already committed.
  const runtime = getScrapeRuntime();
  const categoryIdentities = insertValues.filter(
    (value) => value.source && value.externalId
  );
  const categoryTargets =
    runtime && categoryIdentities.length
      ? await db
          .select({ id: events.id, externalId: events.externalId })
          .from(events)
          .where(
            or(
              ...categoryIdentities.map((value) =>
                and(
                  eq(events.source, value.source!),
                  eq(events.externalId, value.externalId!)
                )
              )
            )
          )
      : upserted;
  if (categoryTargets.length > 0) {
    const categoryMap = new Map<string, string[]>();
    scrapedEvents.forEach((e) => {
      if (e.externalId) {
        categoryMap.set(
          e.externalId,
          (e.categories ?? []).filter((k) => validCategoryKeys.has(k))
        );
      }
    });
    await mapScraperItems(categoryTargets, async (row) => {
      const cats = row.externalId
        ? (categoryMap.get(row.externalId) ?? [])
        : [];
      if (cats.length > 0) {
        if (runtime) {
          const existing = await db
            .select({ id: eventCategories.id })
            .from(eventCategories)
            .where(eq(eventCategories.eventId, row.id))
            .limit(1);
          if (existing.length) return;
          assertScrapeActive();
          await db.transaction(async (tx) => {
            await setEventCategoryKeys(tx, row.id, cats, { activeOnly: true });
          });
        } else {
          await setEventCategoryKeys(db, row.id, cats, { activeOnly: true });
        }
      }
    });
  }
  // Resolve every scraped row, not only newly inserted/location-updated rows.
  // This repairs existing Posh events whose images were previously left on
  // images.posh.vip and avoids replacing an already-hosted image each run.
  const imageUpdates = (
    await mapScraperItems(
      validScrapedValues.filter(
        (value) => value.source && value.externalId && value.coverImageUrl
      ),
      async (value) => {
        const existingEvent = await db.query.events.findFirst({
          where: and(
            eq(events.source, value.source!),
            eq(events.externalId, value.externalId!)
          ),
          columns: {
            id: true,
            coverImageUrl: true,
            sourceImageUrl: true,
          },
        });
        if (!existingEvent) {
          return [];
        }
        return [
          {
            id: existingEvent.id,
            coverImageUrl: value.coverImageUrl!,
            currentCoverImageUrl: existingEvent.coverImageUrl,
            currentSourceImageUrl: existingEvent.sourceImageUrl,
          },
        ];
      }
    )
  ).flat();
  if (runtime) {
    const imageSignal = AbortSignal.any([
      runtime.signal,
      AbortSignal.timeout(15000),
    ]);
    await mapConcurrent(imageUpdates, 2, async (image) => {
      if (imageSignal.aborted) {
        const warning = "Image hosting deferred: image budget reached";
        if (!runtime.warnings.includes(warning)) runtime.warnings.push(warning);
        return;
      }
      const result = await rehostScrapedEventImage(
        image.id,
        image.coverImageUrl,
        image.currentCoverImageUrl,
        image.currentSourceImageUrl,
        { signal: imageSignal, db }
      );
      if (result === "failed" && runtime.warnings.length < 20)
        runtime.warnings.push(`Image hosting failed for ${image.id}`);
    });
  } else {
    await mapSettledScraperItems(
      imageUpdates,
      async ({
        id,
        coverImageUrl,
        currentCoverImageUrl,
        currentSourceImageUrl,
      }) => {
        await rehostScrapedEventImage(
          id,
          coverImageUrl,
          currentCoverImageUrl,
          currentSourceImageUrl
        );
      }
    );
  }
  const eventsAddedData = upserted.map((r) => ({
    id: r.id,
    title: r.title,
    externalId: r.externalId,
  }));
  const hasErrors =
    (scrapeResult.errors?.length ?? 0) > 0 ||
    Boolean(
      runtime &&
      (scrapeResult.complete === false ||
        runtime.incomplete ||
        validScrapedValues.length < scrapedEvents.length)
    );
  return {
    status: (runtime ? hasErrors : hasErrors && upserted.length === 0)
      ? "partial"
      : "success",
    eventsFound: scrapedEvents.length,
    eventsAdded: upserted.length,
    error: hasErrors
      ? `Incomplete scrape: ${scrapeResult.errors?.map((e) => e.error).join("; ") || "Some provider data could not be fetched"}`
      : null,
    data: { eventsFound: eventsFoundData, eventsAdded: eventsAddedData },
  };
}
