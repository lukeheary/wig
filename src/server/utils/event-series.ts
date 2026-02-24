import { and, eq, inArray } from "drizzle-orm";
import { eventSeries, events } from "@/server/db/schema";
import { setEventCategoryKeys } from "@/server/utils/categories";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKAHEAD_DAYS = 30;

type EventSeriesRow = typeof eventSeries.$inferSelect;

interface MaterializeOptions {
  seriesIds?: string[];
  now?: Date;
  windowStart?: Date;
  windowEnd?: Date;
  lookaheadDays?: number;
}

interface MaterializeResult {
  processedSeries: number;
  createdEvents: number;
  firstCreatedEventId: string | null;
}

export function normalizeSeriesDaysOfWeek(
  frequency: "daily" | "weekly" | "monthly",
  daysOfWeek: number[] | null | undefined,
  startAt: Date
) {
  if (frequency === "daily") return null;
  const startWeekday = startAt.getDay();

  const deduped = Array.from(
    new Set((daysOfWeek ?? []).filter((day) => day >= 0 && day <= 6))
  ).sort((a, b) => a - b);

  if (frequency === "monthly") {
    // Monthly recurrence is anchored to the start date's weekday pattern.
    return [startWeekday];
  }

  if (deduped.length > 0) {
    if (deduped.includes(startWeekday)) {
      return deduped;
    }
    // Safeguard against stale UI payloads: include first event weekday.
    return [...deduped, startWeekday].sort((a, b) => a - b);
  }

  return [startWeekday];
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek(value: Date) {
  const date = startOfDay(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function addMonths(value: Date, months: number) {
  const date = new Date(value);
  date.setMonth(date.getMonth() + months);
  return date;
}

function startOfMonth(value: Date) {
  const date = startOfDay(value);
  date.setDate(1);
  return date;
}

function getMonthsBetween(start: Date, end: Date) {
  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth())
  );
}

function getWeekdayOrdinalInMonth(value: Date) {
  return Math.floor((value.getDate() - 1) / 7) + 1;
}

function getNthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  ordinal: number
) {
  const firstDay = new Date(year, month, 1);
  const firstDayWeekday = firstDay.getDay();
  const offset = (weekday - firstDayWeekday + 7) % 7;
  const dayOfMonth = 1 + offset + (ordinal - 1) * 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  if (dayOfMonth > daysInMonth) {
    return null;
  }

  return new Date(year, month, dayOfMonth);
}

function combineDateWithSeriesTime(day: Date, seriesStartAt: Date) {
  const combined = new Date(day);
  combined.setHours(
    seriesStartAt.getHours(),
    seriesStartAt.getMinutes(),
    seriesStartAt.getSeconds(),
    seriesStartAt.getMilliseconds()
  );
  return combined;
}

function clampWindow(series: EventSeriesRow, windowStart: Date, windowEnd: Date) {
  const effectiveStart = series.startAt > windowStart ? series.startAt : windowStart;
  const untilDate = series.untilDate ?? null;
  const effectiveEnd =
    untilDate && untilDate < windowEnd ? untilDate : windowEnd;

  if (effectiveEnd < effectiveStart) {
    return null;
  }

  return { effectiveStart, effectiveEnd };
}

function buildDailyOccurrences(
  series: EventSeriesRow,
  effectiveStart: Date,
  effectiveEnd: Date
) {
  const intervalDays = Math.max(1, series.interval);
  const occurrences: Date[] = [];
  let current = new Date(series.startAt);

  if (current < effectiveStart) {
    const diffDays = Math.floor(
      (startOfDay(effectiveStart).getTime() - startOfDay(current).getTime()) /
        MS_PER_DAY
    );
    const steps = Math.max(0, Math.floor(diffDays / intervalDays));
    current = addDays(current, steps * intervalDays);
  }

  while (current < effectiveStart) {
    current = addDays(current, intervalDays);
  }

  while (current <= effectiveEnd) {
    occurrences.push(new Date(current));
    current = addDays(current, intervalDays);
  }

  return occurrences;
}

function buildWeeklyOccurrences(
  series: EventSeriesRow,
  effectiveStart: Date,
  effectiveEnd: Date
) {
  const intervalWeeks = Math.max(1, series.interval);
  const daysOfWeek = normalizeSeriesDaysOfWeek(
    "weekly",
    series.daysOfWeek,
    series.startAt
  );
  const daySet = new Set(daysOfWeek ?? []);

  const occurrences: Date[] = [];
  let cursor = startOfDay(effectiveStart);
  const endDay = startOfDay(effectiveEnd);
  const anchorWeekStart = startOfWeek(series.startAt);

  while (cursor <= endDay) {
    if (cursor >= startOfDay(series.startAt) && daySet.has(cursor.getDay())) {
      const weeksSinceAnchor = Math.floor(
        (startOfWeek(cursor).getTime() - anchorWeekStart.getTime()) /
          (7 * MS_PER_DAY)
      );
      if (weeksSinceAnchor >= 0 && weeksSinceAnchor % intervalWeeks === 0) {
        const occurrence = combineDateWithSeriesTime(cursor, series.startAt);
        if (occurrence >= effectiveStart && occurrence <= effectiveEnd) {
          occurrences.push(occurrence);
        }
      }
    }
    cursor = addDays(cursor, 1);
  }

  return occurrences;
}

function buildMonthlyOccurrences(
  series: EventSeriesRow,
  effectiveStart: Date,
  effectiveEnd: Date
) {
  const intervalMonths = Math.max(1, series.interval);
  const daysOfWeek = normalizeSeriesDaysOfWeek(
    "monthly",
    series.daysOfWeek,
    series.startAt
  );
  const weekday = daysOfWeek?.[0] ?? series.startAt.getDay();
  const weekdayOrdinal = getWeekdayOrdinalInMonth(series.startAt);

  const occurrences: Date[] = [];
  const seriesStartDay = startOfDay(series.startAt);
  const anchorMonthStart = startOfMonth(series.startAt);
  let cursorMonthStart = startOfMonth(effectiveStart);
  const endMonthStart = startOfMonth(effectiveEnd);

  while (cursorMonthStart <= endMonthStart) {
    const monthsSinceAnchor = getMonthsBetween(anchorMonthStart, cursorMonthStart);
    if (monthsSinceAnchor >= 0 && monthsSinceAnchor % intervalMonths === 0) {
      const occurrenceDay = getNthWeekdayOfMonth(
        cursorMonthStart.getFullYear(),
        cursorMonthStart.getMonth(),
        weekday,
        weekdayOrdinal
      );

      if (occurrenceDay && occurrenceDay >= seriesStartDay) {
        const occurrence = combineDateWithSeriesTime(occurrenceDay, series.startAt);
        if (occurrence >= effectiveStart && occurrence <= effectiveEnd) {
          occurrences.push(occurrence);
        }
      }
    }

    cursorMonthStart = addMonths(cursorMonthStart, 1);
  }

  return occurrences;
}

function buildSeriesOccurrences(
  series: EventSeriesRow,
  windowStart: Date,
  windowEnd: Date
) {
  const clampedWindow = clampWindow(series, windowStart, windowEnd);
  if (!clampedWindow) return [];

  if (series.frequency === "daily") {
    return buildDailyOccurrences(
      series,
      clampedWindow.effectiveStart,
      clampedWindow.effectiveEnd
    );
  }

  if (series.frequency === "monthly") {
    return buildMonthlyOccurrences(
      series,
      clampedWindow.effectiveStart,
      clampedWindow.effectiveEnd
    );
  }

  return buildWeeklyOccurrences(
    series,
    clampedWindow.effectiveStart,
    clampedWindow.effectiveEnd
  );
}

function getSeriesDurationMinutes(series: EventSeriesRow) {
  if (typeof series.durationMinutes !== "number") return null;
  if (series.durationMinutes <= 0) return null;
  return series.durationMinutes;
}

function getSeriesCategoryKeys(series: EventSeriesRow) {
  if (!Array.isArray(series.categories)) return [];
  return series.categories.filter((value): value is string => typeof value === "string");
}

export async function materializeEventSeries(
  db: any,
  options: MaterializeOptions = {}
): Promise<MaterializeResult> {
  const now = options.now ?? new Date();
  const windowStart = options.windowStart ?? now;
  const windowEnd =
    options.windowEnd ??
    addDays(windowStart, options.lookaheadDays ?? DEFAULT_LOOKAHEAD_DAYS);

  const conditions = [eq(eventSeries.isActive, true)];
  if (options.seriesIds && options.seriesIds.length > 0) {
    conditions.push(inArray(eventSeries.id, options.seriesIds));
  }

  const activeSeries = await db.query.eventSeries.findMany({
    where: and(...conditions),
  });

  let createdEvents = 0;
  let firstCreatedEventId: string | null = null;

  for (const series of activeSeries) {
    const occurrenceStarts = buildSeriesOccurrences(series, windowStart, windowEnd);

    if (occurrenceStarts.length > 0) {
      const durationMinutes = getSeriesDurationMinutes(series);
      const values = occurrenceStarts.map((startAt) => ({
        seriesId: series.id,
        venueId: series.venueId,
        organizerId: series.organizerId,
        createdByUserId: series.createdByUserId,
        title: series.title,
        description: series.description,
        coverImageUrl: series.coverImageUrl,
        eventUrl: series.eventUrl,
        source: series.source,
        externalId: null,
        startAt,
        endAt:
          durationMinutes == null
            ? null
            : new Date(startAt.getTime() + durationMinutes * 60 * 1000),
        address: series.address,
        city: series.city,
        state: series.state,
        visibility: series.visibility,
        status: series.status,
      }));

      const inserted: Array<{ id: string }> = await db
        .insert(events)
        .values(values)
        .onConflictDoNothing({
          target: [events.seriesId, events.startAt],
        })
        .returning({
          id: events.id,
        });

      if (inserted.length > 0) {
        createdEvents += inserted.length;
        if (!firstCreatedEventId) {
          firstCreatedEventId = inserted[0]?.id ?? null;
        }

        const categoryKeys = getSeriesCategoryKeys(series);
        if (categoryKeys.length > 0) {
          await Promise.all(
            inserted.map((eventRow: { id: string }) =>
              setEventCategoryKeys(db, eventRow.id, categoryKeys, {
                activeOnly: true,
              })
            )
          );
        }
      }
    }

    await db
      .update(eventSeries)
      .set({ lastGeneratedAt: now })
      .where(eq(eventSeries.id, series.id));
  }

  return {
    processedSeries: activeSeries.length,
    createdEvents,
    firstCreatedEventId,
  };
}
