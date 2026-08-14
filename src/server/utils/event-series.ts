import { and, eq, inArray } from "drizzle-orm";
import { eventSeries, events } from "@/server/db/schema";
import { generateNanoId } from "@/lib/nano-id";
import {
  mapEventSeriesCategoryData,
  setEventCategoryKeys,
} from "@/server/utils/categories";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKAHEAD_DAYS = 30;
const timeZoneFormatterCache = new Map<string, Intl.DateTimeFormat>();

type EventSeriesRow = typeof eventSeries.$inferSelect & {
  categoryLinks?: any[];
};

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
  firstCreatedEventPublicId: string | null;
}

interface TimeZoneDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getTimeZoneDateTimeParts(
  date: Date,
  timeZone: string
): TimeZoneDateTimeParts | null {
  try {
    let formatter = timeZoneFormatterCache.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      timeZoneFormatterCache.set(timeZone, formatter);
    }

    const parts = formatter.formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );

    const year = Number(values.year);
    const month = Number(values.month);
    const day = Number(values.day);
    const hour = Number(values.hour);
    const minute = Number(values.minute);
    const second = Number(values.second);

    if (
      Number.isNaN(year) ||
      Number.isNaN(month) ||
      Number.isNaN(day) ||
      Number.isNaN(hour) ||
      Number.isNaN(minute) ||
      Number.isNaN(second)
    ) {
      return null;
    }

    return { year, month, day, hour, minute, second };
  } catch {
    return null;
  }
}

function getSeriesStartWeekday(
  startAt: Date,
  timeZone: string | null | undefined
) {
  if (!timeZone) {
    return startAt.getDay();
  }

  const parts = getTimeZoneDateTimeParts(startAt, timeZone);
  if (!parts) {
    return startAt.getDay();
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function normalizeSeriesDaysOfWeek(
  frequency: "daily" | "weekly" | "monthly",
  daysOfWeek: number[] | null | undefined,
  startAt: Date,
  timeZone?: string | null
) {
  if (frequency === "daily") return null;
  const startWeekday = getSeriesStartWeekday(startAt, timeZone);

  const deduped = Array.from(
    new Set((daysOfWeek ?? []).filter((day) => day >= 0 && day <= 6))
  ).sort((a, b) => a - b);

  if (frequency === "monthly") {
    // Monthly recurrence is anchored to the start date's weekday pattern.
    return [startWeekday];
  }

  if (deduped.length === 0) {
    return [startWeekday];
  }

  if (deduped.includes(startWeekday)) {
    return deduped;
  }

  // Safeguard for stale clients that keep one default weekday from "today"
  // even after choosing a different start date.
  if (deduped.length === 1) {
    return [startWeekday];
  }

  // For explicit multi-day weekly schedules, preserve user selection.
  return deduped;
}

function startOfDayLocal(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeekLocal(value: Date) {
  const date = startOfDayLocal(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function addDaysLocal(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function addMonthsLocal(value: Date, months: number) {
  const date = new Date(value);
  date.setMonth(date.getMonth() + months);
  return date;
}

function startOfMonthLocal(value: Date) {
  const date = startOfDayLocal(value);
  date.setDate(1);
  return date;
}

function getMonthsBetweenLocal(start: Date, end: Date) {
  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth())
  );
}

function getWeekdayOrdinalInMonthLocal(value: Date) {
  return Math.floor((value.getDate() - 1) / 7) + 1;
}

function getNthWeekdayOfMonthLocal(
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

function combineDateWithSeriesTimeLocal(day: Date, seriesStartAt: Date) {
  const combined = new Date(day);
  combined.setHours(
    seriesStartAt.getHours(),
    seriesStartAt.getMinutes(),
    seriesStartAt.getSeconds(),
    seriesStartAt.getMilliseconds()
  );
  return combined;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTimeZoneDateTimeParts(date, timeZone);
  if (!parts) return null;
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

function clampWindow(
  series: EventSeriesRow,
  windowStart: Date,
  windowEnd: Date
) {
  const effectiveStart =
    series.startAt > windowStart ? series.startAt : windowStart;
  const untilDate = series.untilDate ?? null;
  const effectiveEnd =
    untilDate && untilDate < windowEnd ? untilDate : windowEnd;

  if (effectiveEnd < effectiveStart) {
    return null;
  }

  return { effectiveStart, effectiveEnd };
}

function startOfDayUtc(value: Date) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function startOfWeekUtc(value: Date) {
  const date = startOfDayUtc(value);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date;
}

function addDaysUtc(value: Date, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function addMonthsUtc(value: Date, months: number) {
  const date = new Date(value);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
}

function startOfMonthUtc(value: Date) {
  const date = startOfDayUtc(value);
  date.setUTCDate(1);
  return date;
}

function getMonthsBetweenUtc(start: Date, end: Date) {
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth())
  );
}

function getWeekdayOrdinalInMonthUtc(value: Date) {
  return Math.floor((value.getUTCDate() - 1) / 7) + 1;
}

function getNthWeekdayOfMonthUtc(
  year: number,
  month: number,
  weekday: number,
  ordinal: number
) {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const firstDayWeekday = firstDay.getUTCDay();
  const offset = (weekday - firstDayWeekday + 7) % 7;
  const dayOfMonth = 1 + offset + (ordinal - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  if (dayOfMonth > daysInMonth) {
    return null;
  }

  return new Date(Date.UTC(year, month, dayOfMonth));
}

function getTimeZoneDayStart(date: Date, timeZone: string) {
  const parts = getTimeZoneDateTimeParts(date, timeZone);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function combineTimeZoneDayWithSeriesTime(
  dayStart: Date,
  seriesStartAt: Date,
  timeZone: string
) {
  const timeParts = getTimeZoneDateTimeParts(seriesStartAt, timeZone);
  if (!timeParts) {
    return new Date(seriesStartAt);
  }

  const year = dayStart.getUTCFullYear();
  const month = dayStart.getUTCMonth();
  const day = dayStart.getUTCDate();
  const millisecond = seriesStartAt.getUTCMilliseconds();
  const naiveUtcMs = Date.UTC(
    year,
    month,
    day,
    timeParts.hour,
    timeParts.minute,
    timeParts.second,
    millisecond
  );

  let candidateUtcMs = naiveUtcMs;
  for (let i = 0; i < 4; i += 1) {
    const offsetMs = getTimeZoneOffsetMs(new Date(candidateUtcMs), timeZone);
    if (offsetMs == null) {
      break;
    }
    const nextCandidateUtcMs = naiveUtcMs - offsetMs;
    if (nextCandidateUtcMs === candidateUtcMs) {
      break;
    }
    candidateUtcMs = nextCandidateUtcMs;
  }

  return new Date(candidateUtcMs);
}

function buildDailyOccurrencesLocal(
  series: EventSeriesRow,
  effectiveStart: Date,
  effectiveEnd: Date
) {
  const intervalDays = Math.max(1, series.interval);
  const occurrences: Date[] = [];
  let current = new Date(series.startAt);

  if (current < effectiveStart) {
    const diffDays = Math.floor(
      (startOfDayLocal(effectiveStart).getTime() -
        startOfDayLocal(current).getTime()) /
        MS_PER_DAY
    );
    const steps = Math.max(0, Math.floor(diffDays / intervalDays));
    current = addDaysLocal(current, steps * intervalDays);
  }

  while (current < effectiveStart) {
    current = addDaysLocal(current, intervalDays);
  }

  while (current <= effectiveEnd) {
    occurrences.push(new Date(current));
    current = addDaysLocal(current, intervalDays);
  }

  return occurrences;
}

function buildWeeklyOccurrencesLocal(
  series: EventSeriesRow,
  effectiveStart: Date,
  effectiveEnd: Date
) {
  const intervalWeeks = Math.max(1, series.interval);
  const daysOfWeek = normalizeSeriesDaysOfWeek(
    "weekly",
    series.daysOfWeek,
    series.startAt,
    series.timeZone
  );
  const daySet = new Set(daysOfWeek ?? []);

  const occurrences: Date[] = [];
  let cursor = startOfDayLocal(effectiveStart);
  const endDay = startOfDayLocal(effectiveEnd);
  const anchorWeekStart = startOfWeekLocal(series.startAt);

  while (cursor <= endDay) {
    if (
      cursor >= startOfDayLocal(series.startAt) &&
      daySet.has(cursor.getDay())
    ) {
      const weeksSinceAnchor = Math.floor(
        (startOfWeekLocal(cursor).getTime() - anchorWeekStart.getTime()) /
          (7 * MS_PER_DAY)
      );
      if (weeksSinceAnchor >= 0 && weeksSinceAnchor % intervalWeeks === 0) {
        const occurrence = combineDateWithSeriesTimeLocal(
          cursor,
          series.startAt
        );
        if (occurrence >= effectiveStart && occurrence <= effectiveEnd) {
          occurrences.push(occurrence);
        }
      }
    }
    cursor = addDaysLocal(cursor, 1);
  }

  return occurrences;
}

function buildMonthlyOccurrencesLocal(
  series: EventSeriesRow,
  effectiveStart: Date,
  effectiveEnd: Date
) {
  const intervalMonths = Math.max(1, series.interval);
  const daysOfWeek = normalizeSeriesDaysOfWeek(
    "monthly",
    series.daysOfWeek,
    series.startAt,
    series.timeZone
  );
  const weekday = daysOfWeek?.[0] ?? series.startAt.getDay();
  const weekdayOrdinal = getWeekdayOrdinalInMonthLocal(series.startAt);

  const occurrences: Date[] = [];
  const seriesStartDay = startOfDayLocal(series.startAt);
  const anchorMonthStart = startOfMonthLocal(series.startAt);
  let cursorMonthStart = startOfMonthLocal(effectiveStart);
  const endMonthStart = startOfMonthLocal(effectiveEnd);

  while (cursorMonthStart <= endMonthStart) {
    const monthsSinceAnchor = getMonthsBetweenLocal(
      anchorMonthStart,
      cursorMonthStart
    );
    if (monthsSinceAnchor >= 0 && monthsSinceAnchor % intervalMonths === 0) {
      const occurrenceDay = getNthWeekdayOfMonthLocal(
        cursorMonthStart.getFullYear(),
        cursorMonthStart.getMonth(),
        weekday,
        weekdayOrdinal
      );

      if (occurrenceDay && occurrenceDay >= seriesStartDay) {
        const occurrence = combineDateWithSeriesTimeLocal(
          occurrenceDay,
          series.startAt
        );
        if (occurrence >= effectiveStart && occurrence <= effectiveEnd) {
          occurrences.push(occurrence);
        }
      }
    }

    cursorMonthStart = addMonthsLocal(cursorMonthStart, 1);
  }

  return occurrences;
}

function buildDailyOccurrencesInTimeZone(
  series: EventSeriesRow,
  effectiveStart: Date,
  effectiveEnd: Date,
  timeZone: string
) {
  const seriesStartDay = getTimeZoneDayStart(series.startAt, timeZone);
  const effectiveStartDay = getTimeZoneDayStart(effectiveStart, timeZone);
  const effectiveEndDay = getTimeZoneDayStart(effectiveEnd, timeZone);

  if (!seriesStartDay || !effectiveStartDay || !effectiveEndDay) {
    return buildDailyOccurrencesLocal(series, effectiveStart, effectiveEnd);
  }

  const intervalDays = Math.max(1, series.interval);
  const occurrences: Date[] = [];
  let currentDay = new Date(seriesStartDay);

  if (currentDay < effectiveStartDay) {
    const diffDays = Math.floor(
      (effectiveStartDay.getTime() - currentDay.getTime()) / MS_PER_DAY
    );
    const steps = Math.max(0, Math.floor(diffDays / intervalDays));
    currentDay = addDaysUtc(currentDay, steps * intervalDays);
  }

  while (currentDay < effectiveStartDay) {
    currentDay = addDaysUtc(currentDay, intervalDays);
  }

  while (currentDay <= effectiveEndDay) {
    const occurrence = combineTimeZoneDayWithSeriesTime(
      currentDay,
      series.startAt,
      timeZone
    );
    if (occurrence >= effectiveStart && occurrence <= effectiveEnd) {
      occurrences.push(occurrence);
    }
    currentDay = addDaysUtc(currentDay, intervalDays);
  }

  return occurrences;
}

function buildWeeklyOccurrencesInTimeZone(
  series: EventSeriesRow,
  effectiveStart: Date,
  effectiveEnd: Date,
  timeZone: string
) {
  const seriesStartDay = getTimeZoneDayStart(series.startAt, timeZone);
  const effectiveStartDay = getTimeZoneDayStart(effectiveStart, timeZone);
  const effectiveEndDay = getTimeZoneDayStart(effectiveEnd, timeZone);

  if (!seriesStartDay || !effectiveStartDay || !effectiveEndDay) {
    return buildWeeklyOccurrencesLocal(series, effectiveStart, effectiveEnd);
  }

  const intervalWeeks = Math.max(1, series.interval);
  const daysOfWeek = normalizeSeriesDaysOfWeek(
    "weekly",
    series.daysOfWeek,
    series.startAt,
    timeZone
  );
  const daySet = new Set(daysOfWeek ?? []);

  const occurrences: Date[] = [];
  let cursorDay = new Date(effectiveStartDay);
  const anchorWeekStart = startOfWeekUtc(seriesStartDay);

  while (cursorDay <= effectiveEndDay) {
    if (cursorDay >= seriesStartDay && daySet.has(cursorDay.getUTCDay())) {
      const weeksSinceAnchor = Math.floor(
        (startOfWeekUtc(cursorDay).getTime() - anchorWeekStart.getTime()) /
          (7 * MS_PER_DAY)
      );

      if (weeksSinceAnchor >= 0 && weeksSinceAnchor % intervalWeeks === 0) {
        const occurrence = combineTimeZoneDayWithSeriesTime(
          cursorDay,
          series.startAt,
          timeZone
        );
        if (occurrence >= effectiveStart && occurrence <= effectiveEnd) {
          occurrences.push(occurrence);
        }
      }
    }

    cursorDay = addDaysUtc(cursorDay, 1);
  }

  return occurrences;
}

function buildMonthlyOccurrencesInTimeZone(
  series: EventSeriesRow,
  effectiveStart: Date,
  effectiveEnd: Date,
  timeZone: string
) {
  const seriesStartDay = getTimeZoneDayStart(series.startAt, timeZone);
  const effectiveStartDay = getTimeZoneDayStart(effectiveStart, timeZone);
  const effectiveEndDay = getTimeZoneDayStart(effectiveEnd, timeZone);

  if (!seriesStartDay || !effectiveStartDay || !effectiveEndDay) {
    return buildMonthlyOccurrencesLocal(series, effectiveStart, effectiveEnd);
  }

  const intervalMonths = Math.max(1, series.interval);
  const daysOfWeek = normalizeSeriesDaysOfWeek(
    "monthly",
    series.daysOfWeek,
    series.startAt,
    timeZone
  );
  const weekday = daysOfWeek?.[0] ?? seriesStartDay.getUTCDay();
  const weekdayOrdinal = getWeekdayOrdinalInMonthUtc(seriesStartDay);

  const occurrences: Date[] = [];
  const anchorMonthStart = startOfMonthUtc(seriesStartDay);
  let cursorMonthStart = startOfMonthUtc(effectiveStartDay);
  const endMonthStart = startOfMonthUtc(effectiveEndDay);

  while (cursorMonthStart <= endMonthStart) {
    const monthsSinceAnchor = getMonthsBetweenUtc(
      anchorMonthStart,
      cursorMonthStart
    );
    if (monthsSinceAnchor >= 0 && monthsSinceAnchor % intervalMonths === 0) {
      const occurrenceDay = getNthWeekdayOfMonthUtc(
        cursorMonthStart.getUTCFullYear(),
        cursorMonthStart.getUTCMonth(),
        weekday,
        weekdayOrdinal
      );

      if (occurrenceDay && occurrenceDay >= seriesStartDay) {
        const occurrence = combineTimeZoneDayWithSeriesTime(
          occurrenceDay,
          series.startAt,
          timeZone
        );
        if (occurrence >= effectiveStart && occurrence <= effectiveEnd) {
          occurrences.push(occurrence);
        }
      }
    }

    cursorMonthStart = addMonthsUtc(cursorMonthStart, 1);
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

  if (series.timeZone) {
    if (series.frequency === "daily") {
      return buildDailyOccurrencesInTimeZone(
        series,
        clampedWindow.effectiveStart,
        clampedWindow.effectiveEnd,
        series.timeZone
      );
    }

    if (series.frequency === "monthly") {
      return buildMonthlyOccurrencesInTimeZone(
        series,
        clampedWindow.effectiveStart,
        clampedWindow.effectiveEnd,
        series.timeZone
      );
    }

    return buildWeeklyOccurrencesInTimeZone(
      series,
      clampedWindow.effectiveStart,
      clampedWindow.effectiveEnd,
      series.timeZone
    );
  }

  if (series.frequency === "daily") {
    return buildDailyOccurrencesLocal(
      series,
      clampedWindow.effectiveStart,
      clampedWindow.effectiveEnd
    );
  }

  if (series.frequency === "monthly") {
    return buildMonthlyOccurrencesLocal(
      series,
      clampedWindow.effectiveStart,
      clampedWindow.effectiveEnd
    );
  }

  return buildWeeklyOccurrencesLocal(
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
  return mapEventSeriesCategoryData(series).categories;
}

export async function materializeEventSeries(
  db: any,
  options: MaterializeOptions = {}
): Promise<MaterializeResult> {
  const now = options.now ?? new Date();
  const windowStart = options.windowStart ?? now;
  const windowEnd =
    options.windowEnd ??
    addDaysLocal(windowStart, options.lookaheadDays ?? DEFAULT_LOOKAHEAD_DAYS);

  const conditions = [eq(eventSeries.isActive, true)];
  if (options.seriesIds && options.seriesIds.length > 0) {
    conditions.push(inArray(eventSeries.id, options.seriesIds));
  }

  const activeSeries = await db.query.eventSeries.findMany({
    where: and(...conditions),
    with: {
      categoryLinks: {
        with: {
          category: true,
        },
      },
    },
  });

  let createdEvents = 0;
  let firstCreatedEventId: string | null = null;
  let firstCreatedEventPublicId: string | null = null;

  for (const series of activeSeries) {
    const occurrenceStarts = buildSeriesOccurrences(
      series,
      windowStart,
      windowEnd
    );

    if (occurrenceStarts.length > 0) {
      const durationMinutes = getSeriesDurationMinutes(series);
      const values = occurrenceStarts.map((startAt) => {
        return {
          publicId: generateNanoId(),
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
          timeZone: series.timeZone,
          endAt:
            durationMinutes == null
              ? null
              : new Date(startAt.getTime() + durationMinutes * 60 * 1000),
          address: series.address,
          city: series.city,
          state: series.state,
          visibility: series.visibility,
          status: series.status,
        };
      });

      const inserted: Array<{ id: string; publicId: string }> = await db
        .insert(events)
        .values(values)
        .onConflictDoNothing({
          target: [events.seriesId, events.startAt],
        })
        .returning({
          id: events.id,
          publicId: events.publicId,
        });

      if (inserted.length > 0) {
        createdEvents += inserted.length;
        if (!firstCreatedEventId) {
          firstCreatedEventId = inserted[0]?.id ?? null;
          firstCreatedEventPublicId = inserted[0]?.publicId ?? null;
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
    firstCreatedEventPublicId,
  };
}
