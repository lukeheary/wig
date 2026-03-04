import { z } from "zod";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "../init";
import {
  categories,
  eventActivity,
  eventRsvps,
  eventCategories,
  eventSeries,
  events,
  placeFollows,
  placeMembers,
  places,
  cities,
  metroAreas,
  userFriends,
  userPartners,
  users,
} from "../../db/schema";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { uploadImageFromUrl, BUCKET_NAME } from "@/lib/s3";
import { TRPCError } from "@trpc/server";
import { logActivity } from "../../utils/activity-logger";
import { logEventActivity } from "../../utils/event-activity-logger";
import {
  filterExistingCategoryKeys,
  mapEventCategoryData,
  mapEventSeriesCategoryData,
  setEventCategoryKeys,
  setEventSeriesCategoryKeys,
} from "@/server/utils/categories";
import {
  materializeEventSeries,
  normalizeSeriesDaysOfWeek,
} from "@/server/utils/event-series";
import { EVENT_STATUS_VALUES, type EventStatus } from "@/lib/event-status";

function resolveEventUpdateActivityType(
  previousStatus: EventStatus,
  nextStatus: EventStatus,
  startAtChanged: boolean
): "updated" | "cancelled" | "postponed" | "rescheduled" | "restored" {
  if (previousStatus !== nextStatus) {
    if (nextStatus === "cancelled") return "cancelled";
    if (nextStatus === "postponed") return "postponed";
    if (previousStatus !== "active" && nextStatus === "active") return "restored";
    return "updated";
  }

  if (startAtChanged) {
    return "rescheduled";
  }

  return "updated";
}

async function assertCanManageSeries(
  ctx: any,
  series: {
    id: string;
    createdByUserId: string;
    venueId: string | null;
    organizerId: string | null;
  }
) {
  const user = await ctx.db.query.users.findFirst({
    where: eq(users.id, ctx.auth.userId),
  });
  const isAdmin = user?.role === "admin";

  if (isAdmin || series.createdByUserId === ctx.auth.userId) {
    return;
  }

  const manageablePlaceIds = [series.venueId, series.organizerId].filter(
    (value): value is string => !!value
  );

  if (manageablePlaceIds.length > 0) {
    const membership = await ctx.db.query.placeMembers.findFirst({
      where: and(
        eq(placeMembers.userId, ctx.auth.userId),
        inArray(placeMembers.placeId, manageablePlaceIds)
      ),
    });

    if (membership) {
      return;
    }
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You do not have permission to edit this recurring event",
  });
}

export const eventRouter = router({
  createEvent: protectedProcedure
    .input(
      z.object({
        venueId: z.string().uuid().optional(),
        organizerId: z.string().uuid().optional(),
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        coverImageUrl: z.string().url().optional(),
        eventUrl: z.string().url().optional(),
        source: z.string().max(50).optional(),
        externalId: z.string().optional(),
        startAt: z.date(),
        endAt: z.date().optional(),
        address: z.string().optional(),
        city: z.string().min(1).max(100),
        state: z.string().length(2),
        timeZone: z.string().min(1).max(64).optional(),
        categories: z.array(z.string()).optional().default([]),
        visibility: z.enum(["public", "private"]).default("public"),
        status: z.enum(EVENT_STATUS_VALUES).default("active"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user is admin
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
      });
      const isAdmin = user?.role === "admin";

      // If venueId provided, verify user is place member or admin
      if (input.venueId && !isAdmin) {
        const isMember = await ctx.db.query.placeMembers.findFirst({
          where: and(
            eq(placeMembers.userId, ctx.auth.userId),
            eq(placeMembers.placeId, input.venueId)
          ),
        });

        if (!isMember) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this venue",
          });
        }
      }

      // If organizerId provided, verify user is place member or admin
      if (input.organizerId && !isAdmin) {
        const isMember = await ctx.db.query.placeMembers.findFirst({
          where: and(
            eq(placeMembers.userId, ctx.auth.userId),
            eq(placeMembers.placeId, input.organizerId)
          ),
        });

        if (!isMember) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this organizer",
          });
        }
      }

      // Validate startAt < endAt if endAt provided
      if (input.endAt && input.startAt >= input.endAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "End time must be after start time",
        });
      }

      // Filter to only valid categories
      const validCategories = await filterExistingCategoryKeys(
        ctx.db,
        input.categories || [],
        { activeOnly: true }
      );

      const [event] = await ctx.db
        .insert(events)
        .values({
          title: input.title,
          city: input.city,
          state: input.state,
          startAt: input.startAt,
          visibility: input.visibility,
          status: input.status,
          createdByUserId: ctx.auth.userId,
          description: input.description ?? null,
          address: input.address ?? null,
          endAt: input.endAt ?? null,
          venueId: input.venueId ?? null,
          organizerId: input.organizerId ?? null,
          coverImageUrl: input.coverImageUrl ?? null,
          eventUrl: input.eventUrl ?? null,
          source: input.source ?? null,
          externalId: input.externalId ?? null,
        } as any)
        .returning();

      if (event && validCategories.length > 0) {
        await setEventCategoryKeys(ctx.db, event.id, validCategories, {
          activeOnly: true,
        });
      }

      if (event?.coverImageUrl) {
        try {
          const eventCoverImageUrl = await uploadImageFromUrl(
            event.coverImageUrl,
            `events/${event.id}`,
            "cover-image.png"
          );

          await ctx.db
            .update(events)
            .set({ coverImageUrl: eventCoverImageUrl })
            .where(eq(events.id, event.id));
        } catch {
          // Keep existing cover image URL if re-hosting fails.
        }
      }

      // if (event) {
      //   void logActivity({
      //     actorUserId: ctx.auth.userId,
      //     type: "created_event",
      //     entityType: "event",
      //     entityId: event.id,
      //     metadata: {},
      //   });
      // }

      if (!event) return event;

      void logEventActivity({
        actorUserId: ctx.auth.userId,
        eventId: event.id,
        type: "created",
        metadata: {
          status: event.status,
          createdVia: "manual",
        },
      });

      const created = await ctx.db.query.events.findFirst({
        where: eq(events.id, event.id),
        with: {
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      return created ? mapEventCategoryData(created) : event;
    }),

  createRecurringEvent: protectedProcedure
    .input(
      z.object({
        venueId: z.string().uuid().optional(),
        organizerId: z.string().uuid().optional(),
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        coverImageUrl: z.string().url().optional(),
        eventUrl: z.string().url().optional(),
        source: z.string().max(50).optional(),
        externalId: z.string().optional(),
        startAt: z.date(),
        endAt: z.date().optional(),
        address: z.string().optional(),
        city: z.string().min(1).max(100),
        state: z.string().length(2),
        timeZone: z.string().min(1).max(64).optional(),
        categories: z.array(z.string()).optional().default([]),
        visibility: z.enum(["public", "private"]).default("public"),
        status: z.enum(EVENT_STATUS_VALUES).default("active"),
        recurrence: z.object({
          frequency: z.enum(["daily", "weekly", "monthly"]),
          interval: z.number().int().min(1).max(12).default(1),
          daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
          untilDate: z.date().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
      });
      const isAdmin = user?.role === "admin";

      if (input.venueId && !isAdmin) {
        const isMember = await ctx.db.query.placeMembers.findFirst({
          where: and(
            eq(placeMembers.userId, ctx.auth.userId),
            eq(placeMembers.placeId, input.venueId)
          ),
        });

        if (!isMember) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this venue",
          });
        }
      }

      if (input.organizerId && !isAdmin) {
        const isMember = await ctx.db.query.placeMembers.findFirst({
          where: and(
            eq(placeMembers.userId, ctx.auth.userId),
            eq(placeMembers.placeId, input.organizerId)
          ),
        });

        if (!isMember) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this organizer",
          });
        }
      }

      if (input.endAt && input.startAt >= input.endAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "End time must be after start time",
        });
      }

      if (
        input.recurrence.untilDate &&
        input.recurrence.untilDate < input.startAt
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Series end date must be after the first event date",
        });
      }

      const validCategories = await filterExistingCategoryKeys(
        ctx.db,
        input.categories || [],
        { activeOnly: true }
      );

      const durationMinutes = input.endAt
        ? Math.floor((input.endAt.getTime() - input.startAt.getTime()) / 60000)
        : null;

      const normalizedDaysOfWeek = normalizeSeriesDaysOfWeek(
        input.recurrence.frequency,
        input.recurrence.daysOfWeek,
        input.startAt,
        input.timeZone
      );

      const [series] = await ctx.db
        .insert(eventSeries)
        .values({
          title: input.title,
          description: input.description ?? null,
          coverImageUrl: input.coverImageUrl ?? null,
          eventUrl: input.eventUrl ?? null,
          source: input.source ?? null,
          externalId: input.externalId ?? null,
          startAt: input.startAt,
          durationMinutes,
          address: input.address ?? null,
          city: input.city,
          state: input.state,
          visibility: input.visibility,
          status: input.status,
          frequency: input.recurrence.frequency,
          interval: input.recurrence.interval,
          daysOfWeek: normalizedDaysOfWeek,
          timeZone: input.timeZone ?? null,
          untilDate: input.recurrence.untilDate ?? null,
          venueId: input.venueId ?? null,
          organizerId: input.organizerId ?? null,
          createdByUserId: ctx.auth.userId,
        })
        .returning({ id: eventSeries.id });

      if (!series) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create recurring event series",
        });
      }

      await setEventSeriesCategoryKeys(ctx.db, series.id, validCategories, {
        activeOnly: true,
      });

      let resolvedCoverImageUrl = input.coverImageUrl ?? null;
      if (resolvedCoverImageUrl) {
        try {
          resolvedCoverImageUrl = await uploadImageFromUrl(
            resolvedCoverImageUrl,
            `event-series/${series.id}`,
            "cover-image.png"
          );

          await ctx.db
            .update(eventSeries)
            .set({ coverImageUrl: resolvedCoverImageUrl })
            .where(eq(eventSeries.id, series.id));
        } catch {
          // Keep the existing URL if re-hosting fails.
        }
      }

      const generated = await materializeEventSeries(ctx.db, {
        seriesIds: [series.id],
        ...(input.recurrence.untilDate
          ? { windowEnd: input.recurrence.untilDate }
          : {}),
      });

      if (generated.firstCreatedEventId) {
        void logEventActivity({
          actorUserId: ctx.auth.userId,
          eventId: generated.firstCreatedEventId,
          type: "created",
          metadata: {
            recurring: true,
            seriesId: series.id,
            status: input.status,
          },
        });
      }

      // if (generated.firstCreatedEventId) {
      //   void logActivity({
      //     actorUserId: ctx.auth.userId,
      //     type: "created_event",
      //     entityType: "event",
      //     entityId: generated.firstCreatedEventId,
      //     metadata: {
      //       recurring: true,
      //       seriesId: series.id,
      //     },
      //   });
      // }

      return {
        seriesId: series.id,
        createdEvents: generated.createdEvents,
        firstEventId: generated.firstCreatedEventId,
      };
    }),

  getEventSeriesById: protectedProcedure
    .input(z.object({ seriesId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const series = await ctx.db.query.eventSeries.findFirst({
        where: eq(eventSeries.id, input.seriesId),
        with: {
          venue: true,
          organizer: true,
          createdBy: true,
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      if (!series) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recurring event series not found",
        });
      }

      await assertCanManageSeries(ctx, series);

      return mapEventSeriesCategoryData(series);
    }),

  updateEventSeries: protectedProcedure
    .input(
      z.object({
        seriesId: z.string().uuid(),
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        coverImageUrl: z.string().url().optional(),
        eventUrl: z.string().url().optional(),
        source: z.string().max(50).optional(),
        externalId: z.string().optional(),
        startAt: z.date(),
        endAt: z.date().optional(),
        address: z.string().optional(),
        city: z.string().min(1).max(100),
        state: z.string().length(2),
        timeZone: z.string().min(1).max(64).optional(),
        categories: z.array(z.string()).optional().default([]),
        visibility: z.enum(["public", "private"]).default("public"),
        status: z.enum(EVENT_STATUS_VALUES).default("active"),
        recurrence: z.object({
          frequency: z.enum(["daily", "weekly", "monthly"]),
          interval: z.number().int().min(1).max(12).default(1),
          daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
          untilDate: z.date().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existingSeries = await ctx.db.query.eventSeries.findFirst({
        where: eq(eventSeries.id, input.seriesId),
      });

      if (!existingSeries) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recurring event series not found",
        });
      }

      await assertCanManageSeries(ctx, existingSeries);

      if (input.endAt && input.startAt >= input.endAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "End time must be after start time",
        });
      }

      if (input.recurrence.untilDate && input.recurrence.untilDate < input.startAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Series end date must be after the first event date",
        });
      }

      const validCategories = await filterExistingCategoryKeys(
        ctx.db,
        input.categories || [],
        { activeOnly: true }
      );

      const durationMinutes = input.endAt
        ? Math.floor((input.endAt.getTime() - input.startAt.getTime()) / 60000)
        : null;

      const nextSeriesTimeZone =
        input.timeZone !== undefined ? input.timeZone : existingSeries.timeZone;

      const normalizedDaysOfWeek = normalizeSeriesDaysOfWeek(
        input.recurrence.frequency,
        input.recurrence.daysOfWeek,
        input.startAt,
        nextSeriesTimeZone
      );

      const [updatedSeries] = await ctx.db
        .update(eventSeries)
        .set({
          title: input.title,
          description: input.description ?? null,
          coverImageUrl:
            input.coverImageUrl !== undefined
              ? input.coverImageUrl
              : existingSeries.coverImageUrl,
          eventUrl:
            input.eventUrl !== undefined ? input.eventUrl : existingSeries.eventUrl,
          source: input.source !== undefined ? input.source : existingSeries.source,
          externalId:
            input.externalId !== undefined
              ? input.externalId
              : existingSeries.externalId,
          startAt: input.startAt,
          durationMinutes,
          address: input.address ?? null,
          city: input.city,
          state: input.state,
          visibility: input.visibility,
          status: input.status,
          frequency: input.recurrence.frequency,
          interval: input.recurrence.interval,
          daysOfWeek: normalizedDaysOfWeek,
          timeZone: nextSeriesTimeZone,
          untilDate: input.recurrence.untilDate ?? null,
          updatedAt: new Date(),
        })
        .where(eq(eventSeries.id, input.seriesId))
        .returning({ id: eventSeries.id });

      if (!updatedSeries) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update recurring event series",
        });
      }

      await setEventSeriesCategoryKeys(ctx.db, input.seriesId, validCategories, {
        activeOnly: true,
      });

      if (input.coverImageUrl) {
        try {
          const seriesCoverImageUrl = await uploadImageFromUrl(
            input.coverImageUrl,
            `event-series/${input.seriesId}`,
            "cover-image.png"
          );

          await ctx.db
            .update(eventSeries)
            .set({ coverImageUrl: seriesCoverImageUrl })
            .where(eq(eventSeries.id, input.seriesId));
        } catch {
          // Keep existing cover image URL if re-hosting fails.
        }
      }

      const now = new Date();
      const futureEventsBeforeUpdate = await ctx.db.query.events.findMany({
        where: and(eq(events.seriesId, input.seriesId), gte(events.startAt, now)),
        columns: {
          startAt: true,
          coverImageUrl: true,
        },
      });

      const customCoverImageByStartAt = new Map<string, string>();
      for (const event of futureEventsBeforeUpdate) {
        if (!event.coverImageUrl) continue;
        // Preserve only per-instance overrides, not inherited series-default images.
        if (event.coverImageUrl !== existingSeries.coverImageUrl) {
          customCoverImageByStartAt.set(
            event.startAt.toISOString(),
            event.coverImageUrl
          );
        }
      }

      await ctx.db
        .delete(events)
        .where(
          and(eq(events.seriesId, input.seriesId), gte(events.startAt, now))
        );

      const generated = await materializeEventSeries(ctx.db, {
        seriesIds: [input.seriesId],
        now,
        ...(input.recurrence.untilDate
          ? { windowEnd: input.recurrence.untilDate }
          : {}),
      });

      const nextEvent = await ctx.db.query.events.findFirst({
        where: and(eq(events.seriesId, input.seriesId), gte(events.startAt, now)),
        orderBy: [asc(events.startAt)],
        columns: { id: true },
      });

      if (customCoverImageByStartAt.size > 0) {
        const regeneratedEvents = await ctx.db.query.events.findMany({
          where: and(eq(events.seriesId, input.seriesId), gte(events.startAt, now)),
          columns: {
            id: true,
            startAt: true,
            coverImageUrl: true,
          },
        });

        for (const event of regeneratedEvents) {
          const preservedCoverImageUrl = customCoverImageByStartAt.get(
            event.startAt.toISOString()
          );

          if (!preservedCoverImageUrl) continue;
          if (event.coverImageUrl === preservedCoverImageUrl) continue;

          await ctx.db
            .update(events)
            .set({ coverImageUrl: preservedCoverImageUrl })
            .where(eq(events.id, event.id));
        }
      }

      return {
        seriesId: input.seriesId,
        createdEvents: generated.createdEvents,
        firstEventId: nextEvent?.id ?? generated.firstCreatedEventId,
      };
    }),

  deleteEventSeries: protectedProcedure
    .input(z.object({ seriesId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existingSeries = await ctx.db.query.eventSeries.findFirst({
        where: eq(eventSeries.id, input.seriesId),
      });

      if (!existingSeries) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recurring event series not found",
        });
      }

      await assertCanManageSeries(ctx, existingSeries);

      const deletedEvents = await ctx.db
        .delete(events)
        .where(eq(events.seriesId, input.seriesId))
        .returning({ id: events.id });

      const [deletedSeries] = await ctx.db
        .delete(eventSeries)
        .where(eq(eventSeries.id, input.seriesId))
        .returning({ id: eventSeries.id });

      if (!deletedSeries) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete recurring event series",
        });
      }

      return {
        success: true,
        deletedEvents: deletedEvents.length,
      };
    }),

  batchCreateEvents: adminProcedure
    .input(
      z.object({
        venueId: z.string().uuid().optional(),
        organizerId: z.string().uuid().optional(),
        overrideExisting: z.boolean().default(false),
        events: z.array(
          z.object({
            title: z.string().min(1).max(255),
            description: z.string().optional(),
            coverImageUrl: z.string().url().optional(),
            eventUrl: z.string().url().optional(),
            source: z.string().max(50).optional(),
            externalId: z.string().optional(),
            startAt: z.date(),
            endAt: z.date().optional(),
            address: z.string().optional(),
            city: z.string().min(1).max(100),
            state: z.string().length(2),
            organizerId: z.string().uuid().optional(),
            venueId: z.string().uuid().optional(),
            categories: z.array(z.string()).optional().default([]),
            visibility: z.enum(["public", "private"]).default("public"),
            status: z.enum(EVENT_STATUS_VALUES).default("active"),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.events.length === 0) {
        return { created: 0 };
      }

      const toEventKey = (event: {
        source?: string | null;
        externalId?: string | null;
        title: string;
        startAt: Date;
        city: string;
        state: string;
      }) =>
        event.source && event.externalId
          ? `${event.source}::${event.externalId}`
          : `${event.title}::${event.startAt.toISOString()}::${event.city}::${event.state}`;

      let dedupedEvents = input.events;

      if (!input.overrideExisting) {
        const eventsWithExternal = input.events.filter(
          (event) => event.source && event.externalId
        );

        const existingKeys = new Set<string>();

        if (eventsWithExternal.length > 0) {
          const bySource = new Map<string, Set<string>>();

          eventsWithExternal.forEach((event) => {
            if (!event.source || !event.externalId) return;
            const set = bySource.get(event.source) ?? new Set<string>();
            set.add(event.externalId);
            bySource.set(event.source, set);
          });

          for (const [source, ids] of bySource.entries()) {
            const rows = await ctx.db.query.events.findMany({
              where: and(
                eq(events.source, source),
                inArray(events.externalId, Array.from(ids))
              ),
              columns: {
                source: true,
                externalId: true,
              },
            });

            rows.forEach((row) => {
              if (row.source && row.externalId) {
                existingKeys.add(`${row.source}::${row.externalId}`);
              }
            });
          }
        }

        const seenKeys = new Set<string>();
        dedupedEvents = input.events.filter((event) => {
          if (event.source && event.externalId) {
            const key = `${event.source}::${event.externalId}`;
            if (existingKeys.has(key)) return false;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
          }
          return true;
        });

        if (dedupedEvents.length === 0) {
          return { created: 0 };
        }
      }

      const allCategoryKeys = Array.from(
        new Set(dedupedEvents.flatMap((event) => event.categories || []))
      );
      const validBatchCategoryKeys = new Set(
        await filterExistingCategoryKeys(ctx.db, allCategoryKeys, {
          activeOnly: true,
        })
      );

      const values = dedupedEvents.map((event) => {
        const categoryKeys = (event.categories || []).filter((key) =>
          validBatchCategoryKeys.has(key)
        );

        return {
          eventKey: toEventKey(event),
          categoryKeys,
          data: {
            title: event.title,
            description: event.description ?? null,
            coverImageUrl: event.coverImageUrl ?? null,
            eventUrl: event.eventUrl ?? null,
            source: event.source ?? null,
            externalId: event.externalId ?? null,
            startAt: event.startAt,
            endAt: event.endAt ?? null,
            address: event.address ?? null,
            city: event.city,
            state: event.state,
            visibility: event.visibility,
            status: event.status,
            createdByUserId: ctx.auth.userId,
            venueId: event.venueId ?? input.venueId ?? null,
            organizerId: event.organizerId ?? input.organizerId ?? null,
          },
        };
      });

      // Insert (or upsert) events
      const insertQuery = ctx.db
        .insert(events)
        .values(values.map((value) => value.data) as any);

      const upserted = await (input.overrideExisting
        ? insertQuery.onConflictDoUpdate({
            target: [events.source, events.externalId],
            set: {
              title: sql`excluded.title`,
              description: sql`excluded.description`,
              coverImageUrl: sql`excluded.cover_image_url`,
              eventUrl: sql`excluded.event_url`,
              startAt: sql`excluded.start_at`,
              endAt: sql`excluded.end_at`,
              address: sql`excluded.address`,
              city: sql`excluded.city`,
              state: sql`excluded.state`,
              updatedAt: sql`now()`,
            },
          })
        : insertQuery.onConflictDoNothing({
            target: [events.source, events.externalId],
          })
      ).returning();

      const categoryKeysByEventKey = new Map(
        values.map((value) => [value.eventKey, value.categoryKeys])
      );

      // Log activity and set categories for newly created events
      const newlyCreated = input.overrideExisting
        ? [] // don't re-log activity for updated rows
        : upserted;

      if (newlyCreated.length > 0) {
        await Promise.all(
          newlyCreated.map((row) =>
            logEventActivity({
              actorUserId: ctx.auth.userId,
              eventId: row.id,
              type: "created",
              metadata: {
                status: row.status,
                createdVia: "batch",
              },
            })
          )
        );
      }

      // Set categories for all upserted rows (both new and overridden)
      if (upserted.length > 0) {
        await Promise.all(
          upserted.map(async (row) => {
            const rowEventKey = toEventKey({
              source: row.source,
              externalId: row.externalId,
              title: row.title,
              startAt: row.startAt,
              city: row.city,
              state: row.state,
            });
            const categoryKeys = categoryKeysByEventKey.get(rowEventKey) || [];
            if (categoryKeys.length === 0) return;
            await setEventCategoryKeys(ctx.db, row.id, categoryKeys, {
              activeOnly: true,
            });
          })
        );
      }

      // Re-upload external cover images to S3 at events/{id}/coverImage.png
      const s3BucketHost = `${BUCKET_NAME}.s3`;
      await Promise.allSettled(
        upserted.map(async (row) => {
          if (!row.coverImageUrl || row.coverImageUrl.includes(s3BucketHost)) {
            return;
          }
          try {
            const s3Url = await uploadImageFromUrl(
              row.coverImageUrl,
              `events/${row.id}`,
              "coverImage.png"
            );
            await ctx.db
              .update(events)
              .set({ coverImageUrl: s3Url })
              .where(eq(events.id, row.id));
          } catch {
            // Keep the original external URL if upload fails
          }
        })
      );

      return { created: upserted.length };
    }),

  listEventsByRange: protectedProcedure
    .input(
      z.object({
        startDate: z.date(),
        endDate: z.date(),
        followedOnly: z.boolean().default(false),
        friendsGoingOnly: z.boolean().default(false),
        category: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        radiusMiles: z.number().min(1).max(200).optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const currentUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
      });

      // Build where conditions
      const conditions = [
        gte(events.startAt, input.startDate),
        lte(events.startAt, input.endDate),
        eq(events.visibility, "public"),
      ];

      // Add category filter
      if (input.category) {
        const matchingEventRows = await ctx.db
          .select({ eventId: eventCategories.eventId })
          .from(eventCategories)
          .innerJoin(categories, eq(categories.id, eventCategories.categoryId))
          .where(eq(categories.key, input.category));

        if (matchingEventRows.length === 0) {
          return [];
        }

        conditions.push(
          inArray(
            events.id,
            matchingEventRows.map((row) => row.eventId)
          )
        );
      }

      // Add location filters
      if (input.city) {
        // Look up metro area first for coordinates and radius
        const metro = await ctx.db.query.metroAreas.findFirst({
          where: eq(metroAreas.name, input.city),
        });

        let originCity: { latitude: number; longitude: number } | undefined;
        if (metro?.latitude != null && metro?.longitude != null) {
          originCity = { latitude: metro.latitude, longitude: metro.longitude };
        } else {
          const resolvedState = input.state ?? currentUser?.state ?? undefined;
          const cityConditions = [eq(cities.name, input.city)];
          if (resolvedState) {
            cityConditions.push(eq(cities.state, resolvedState));
          }
          let cityRecord = await ctx.db.query.cities.findFirst({
            where: and(...cityConditions),
          });
          if (!cityRecord && resolvedState) {
            cityRecord = await ctx.db.query.cities.findFirst({
              where: eq(cities.name, input.city),
            });
          }
          if (cityRecord?.latitude != null && cityRecord?.longitude != null) {
            originCity = {
              latitude: cityRecord.latitude,
              longitude: cityRecord.longitude,
            };
          }
        }

        if (originCity) {
          const radiusMiles = input.radiusMiles ?? metro?.radiusMiles ?? 20;

          const distanceSql = sql`
            (
              3959 * 2 * asin(
                sqrt(
                  pow(sin(radians(${originCity.latitude} - ${cities.latitude}) / 2), 2) +
                  cos(radians(${originCity.latitude})) * cos(radians(${cities.latitude})) *
                  pow(sin(radians(${originCity.longitude} - ${cities.longitude}) / 2), 2)
                )
              )
            )
          `;

          const nearbyEventIds = await ctx.db
            .select({ id: events.id })
            .from(events)
            .innerJoin(
              cities,
              and(eq(cities.name, events.city), eq(cities.state, events.state))
            )
            .where(
              and(
                gte(events.startAt, input.startDate),
                lte(events.startAt, input.endDate),
                eq(events.visibility, "public"),
                sql`${distanceSql} <= ${radiusMiles}`
              )
            );

          if (nearbyEventIds.length === 0) {
            return [];
          }

          conditions.push(
            inArray(
              events.id,
              nearbyEventIds.map((row) => row.id)
            )
          );
        } else {
          conditions.push(eq(events.city, input.city));
          if (input.state) {
            conditions.push(eq(events.state, input.state));
          }
        }
      } else if (input.state) {
        conditions.push(eq(events.state, input.state));
      }

      // Add search filter
      if (input.search) {
        conditions.push(ilike(events.title, `%${input.search}%`));
      }

      // Filter by followed places (venues and organizers)
      if (input.followedOnly) {
        const userPlaceFollows = await ctx.db.query.placeFollows.findMany({
          where: eq(placeFollows.userId, ctx.auth.userId),
        });

        // Get followed places and separate by type
        const followedPlaceIds = userPlaceFollows.map((f) => f.placeId);

        if (followedPlaceIds.length > 0) {
          // Get the places to check their types
          const followedPlaces = await ctx.db.query.places.findMany({
            where: inArray(places.id, followedPlaceIds),
          });

          const followedVenueIds = followedPlaces
            .filter((p) => p.type === "venue")
            .map((p) => p.id);
          const followedOrganizerIds = followedPlaces
            .filter((p) => p.type === "organizer")
            .map((p) => p.id);

          const followConditions = [];
          if (followedVenueIds.length > 0) {
            followConditions.push(inArray(events.venueId, followedVenueIds));
          }
          if (followedOrganizerIds.length > 0) {
            followConditions.push(
              inArray(events.organizerId, followedOrganizerIds)
            );
          }

          if (followConditions.length > 0) {
            conditions.push(or(...followConditions)!);
          } else {
            // User follows nothing, return empty
            return [];
          }
        } else {
          // User follows nothing, return empty
          return [];
        }
      }

      // Filter by events friends are going to
      if (input.friendsGoingOnly) {
        const friendConnections = await ctx.db.query.userFriends.findMany({
          where: and(
            eq(userFriends.userId, ctx.auth.userId),
            eq(userFriends.status, "accepted")
          ),
        });

        const friendIds = friendConnections.map((f) => f.friendUserId);

        if (friendIds.length > 0) {
          const friendRsvps = await ctx.db.query.eventRsvps.findMany({
            where: and(
              inArray(eventRsvps.userId, friendIds),
              eq(eventRsvps.status, "going")
            ),
          });

          const eventIdsWithFriends = friendRsvps.map((r) => r.eventId);

          if (eventIdsWithFriends.length > 0) {
            conditions.push(inArray(events.id, eventIdsWithFriends));
          } else {
            // No friends going to any events
            return [];
          }
        } else {
          // User has no friends
          return [];
        }
      }

      // Fetch events with all conditions
      const eventList = await ctx.db.query.events.findMany({
        where: and(...conditions),
        orderBy: [events.startAt],
        limit: input.limit,
        offset: input.offset,
        with: {
          venue: true,
          organizer: true,
          createdBy: true,
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      // Fetch user's RSVPs for these events
      const eventIds = eventList.map((e) => e.id);
      const userRsvps =
        eventIds.length > 0
          ? await ctx.db.query.eventRsvps.findMany({
              where: and(
                eq(eventRsvps.userId, ctx.auth.userId),
                inArray(eventRsvps.eventId, eventIds)
              ),
            })
          : [];

      // Create a map of event IDs to RSVPs
      const rsvpMap = new Map(userRsvps.map((r) => [r.eventId, r]));

      // Fetch user's friends (bidirectional - where user is either sender or receiver)
      const friendConnections = await ctx.db.query.userFriends.findMany({
        where: and(
          or(
            eq(userFriends.userId, ctx.auth.userId),
            eq(userFriends.friendUserId, ctx.auth.userId)
          ),
          eq(userFriends.status, "accepted")
        ),
      });

      const friendIds = friendConnections.map((f) =>
        f.userId === ctx.auth.userId ? f.friendUserId : f.userId
      );

      // Fetch friends' RSVPs (going status only)
      const friendsRsvps =
        eventIds.length > 0 && friendIds.length > 0
          ? await ctx.db.query.eventRsvps.findMany({
              where: and(
                inArray(eventRsvps.eventId, eventIds),
                inArray(eventRsvps.userId, friendIds),
                eq(eventRsvps.status, "going")
              ),
              with: {
                user: true,
              },
            })
          : [];

      // Create a map of event IDs to attendees (current user + friends)
      const attendeesMap = new Map<string, typeof friendsRsvps>();

      // Add current user if they're going to any events
      for (const userRsvp of userRsvps) {
        if (userRsvp.status === "going" && currentUser) {
          if (!attendeesMap.has(userRsvp.eventId)) {
            attendeesMap.set(userRsvp.eventId, []);
          }
          // Add current user to the beginning of the array
          attendeesMap.get(userRsvp.eventId)!.push({
            ...userRsvp,
            user: currentUser,
          } as any);
        }
      }

      // Add friends to the map
      for (const rsvp of friendsRsvps) {
        if (!attendeesMap.has(rsvp.eventId)) {
          attendeesMap.set(rsvp.eventId, []);
        }
        attendeesMap.get(rsvp.eventId)!.push(rsvp);
      }

      // Attach user RSVP and friends going to each event

      return eventList.map((event) => ({
        ...mapEventCategoryData(event),
        userRsvp: rsvpMap.get(event.id) || null,
        friendsGoing: attendeesMap.get(event.id) || [],
      }));
    }),

  getEventById: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.query.events.findFirst({
        where: eq(events.id, input.eventId),
        with: {
          venue: true,
          organizer: true,
          createdBy: true,
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      // Get user's RSVP if authenticated
      let userRsvp = null;
      if (ctx.auth.userId) {
        userRsvp = await ctx.db.query.eventRsvps.findFirst({
          where: and(
            eq(eventRsvps.eventId, input.eventId),
            eq(eventRsvps.userId, ctx.auth.userId)
          ),
        });
      }

      return {
        ...mapEventCategoryData(event),
        userRsvp,
      };
    }),

  setRsvpStatus: protectedProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        status: z.enum(["going", "interested", "not_going"]),
        includePartner: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify event exists
      const event = await ctx.db.query.events.findFirst({
        where: eq(events.id, input.eventId),
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      const existingUserRsvp = await ctx.db.query.eventRsvps.findFirst({
        where: and(
          eq(eventRsvps.userId, ctx.auth.userId),
          eq(eventRsvps.eventId, input.eventId)
        ),
      });

      const partnerRelationship = await ctx.db.query.userPartners.findFirst({
        where: and(
          eq(userPartners.status, "accepted"),
          or(
            eq(userPartners.requesterId, ctx.auth.userId),
            eq(userPartners.recipientId, ctx.auth.userId)
          )
        ),
      });

      const partnerUserId = partnerRelationship
        ? partnerRelationship.requesterId === ctx.auth.userId
          ? partnerRelationship.recipientId
          : partnerRelationship.requesterId
        : null;
      const existingMirroredPartnerRsvp = partnerUserId
        ? await ctx.db.query.eventRsvps.findFirst({
            where: and(
              eq(eventRsvps.userId, partnerUserId),
              eq(eventRsvps.eventId, input.eventId),
              eq(eventRsvps.partnerRsvpByUserId, ctx.auth.userId)
            ),
          })
        : null;
      const shouldMirrorPartnerRsvp =
        Boolean(partnerUserId) &&
        input.includePartner === true &&
        (input.status === "going" || input.status === "interested");

      // Upsert RSVP
      const [rsvp] = await ctx.db
        .insert(eventRsvps)
        .values({
          userId: ctx.auth.userId,
          eventId: input.eventId,
          status: input.status,
          partnerRsvpByUserId: null,
        })
        .onConflictDoUpdate({
          target: [eventRsvps.userId, eventRsvps.eventId],
          set: {
            status: input.status,
            partnerRsvpByUserId: null,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (partnerUserId) {
        if (shouldMirrorPartnerRsvp) {
          const existingPartnerRsvp = await ctx.db.query.eventRsvps.findFirst({
            where: and(
              eq(eventRsvps.userId, partnerUserId),
              eq(eventRsvps.eventId, input.eventId)
            ),
          });

          const canWriteMirroredRsvp =
            !existingPartnerRsvp ||
            existingPartnerRsvp.partnerRsvpByUserId === ctx.auth.userId;

          if (canWriteMirroredRsvp) {
            await ctx.db
              .insert(eventRsvps)
              .values({
                userId: partnerUserId,
                eventId: input.eventId,
                status: input.status,
                partnerRsvpByUserId: ctx.auth.userId,
              })
              .onConflictDoUpdate({
                target: [eventRsvps.userId, eventRsvps.eventId],
                set: {
                  status: input.status,
                  partnerRsvpByUserId: ctx.auth.userId,
                  updatedAt: new Date(),
                },
              });
          }
        } else {
          await ctx.db
            .delete(eventRsvps)
            .where(
              and(
                eq(eventRsvps.userId, partnerUserId),
                eq(eventRsvps.eventId, input.eventId),
                eq(eventRsvps.partnerRsvpByUserId, ctx.auth.userId)
              )
            );
        }
      }

      if (rsvp && (input.status === "going" || input.status === "interested")) {
        void logActivity({
          actorUserId: ctx.auth.userId,
          type: input.status === "going" ? "rsvp_going" : "rsvp_interested",
          entityType: "event",
          entityId: input.eventId,
          metadata: {
            status: input.status,
            includePartner: shouldMirrorPartnerRsvp,
          },
        });
      } else if (
        input.status === "not_going" &&
        existingUserRsvp?.status === "going"
      ) {
        void logActivity({
          actorUserId: ctx.auth.userId,
          type: "rsvp_not_going",
          entityType: "event",
          entityId: input.eventId,
          metadata: {
            includePartner: Boolean(
              existingMirroredPartnerRsvp &&
              existingMirroredPartnerRsvp.status === "going"
            ),
          },
        });
      }

      return rsvp;
    }),

  deleteRsvp: protectedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existingUserRsvp = await ctx.db.query.eventRsvps.findFirst({
        where: and(
          eq(eventRsvps.eventId, input.eventId),
          eq(eventRsvps.userId, ctx.auth.userId)
        ),
      });

      const partnerRelationship = await ctx.db.query.userPartners.findFirst({
        where: and(
          eq(userPartners.status, "accepted"),
          or(
            eq(userPartners.requesterId, ctx.auth.userId),
            eq(userPartners.recipientId, ctx.auth.userId)
          )
        ),
      });

      const partnerUserId = partnerRelationship
        ? partnerRelationship.requesterId === ctx.auth.userId
          ? partnerRelationship.recipientId
          : partnerRelationship.requesterId
        : null;
      const existingMirroredPartnerRsvp = partnerUserId
        ? await ctx.db.query.eventRsvps.findFirst({
            where: and(
              eq(eventRsvps.eventId, input.eventId),
              eq(eventRsvps.userId, partnerUserId),
              eq(eventRsvps.partnerRsvpByUserId, ctx.auth.userId)
            ),
          })
        : null;

      await ctx.db
        .delete(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, input.eventId),
            eq(eventRsvps.userId, ctx.auth.userId)
          )
        );

      if (partnerUserId) {
        await ctx.db
          .delete(eventRsvps)
          .where(
            and(
              eq(eventRsvps.eventId, input.eventId),
              eq(eventRsvps.userId, partnerUserId),
              eq(eventRsvps.partnerRsvpByUserId, ctx.auth.userId)
            )
          );
      }

      if (existingUserRsvp?.status === "going") {
        void logActivity({
          actorUserId: ctx.auth.userId,
          type: "rsvp_not_going",
          entityType: "event",
          entityId: input.eventId,
          metadata: {
            includePartner: Boolean(
              existingMirroredPartnerRsvp &&
              existingMirroredPartnerRsvp.status === "going"
            ),
          },
        });
      }

      return { success: true };
    }),

  listEventAttendees: publicProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        statusFilter: z.enum(["going", "interested", "not_going"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(eventRsvps.eventId, input.eventId)];

      if (input.statusFilter) {
        conditions.push(eq(eventRsvps.status, input.statusFilter));
      }

      return await ctx.db.query.eventRsvps.findMany({
        where: and(...conditions),
        with: {
          user: true,
        },
        orderBy: [desc(eventRsvps.createdAt)],
      });
    }),

  getUserRsvp: protectedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rsvp = await ctx.db.query.eventRsvps.findFirst({
        where: and(
          eq(eventRsvps.eventId, input.eventId),
          eq(eventRsvps.userId, ctx.auth.userId)
        ),
      });

      return rsvp;
    }),

  updateEvent: protectedProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        coverImageUrl: z.string().url().optional(),
        eventUrl: z.string().url().optional(),
        source: z.string().max(50).optional(),
        externalId: z.string().optional(),
        startAt: z.date().optional(),
        endAt: z.date().optional(),
        address: z.string().optional(),
        city: z.string().min(1).max(100).optional(),
        state: z.string().length(2).optional(),
        categories: z.array(z.string()).optional(),
        visibility: z.enum(["public", "private"]).optional(),
        status: z.enum(EVENT_STATUS_VALUES).optional(),
        venueId: z.string().uuid().optional(),
        organizerId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { eventId, ...updates } = input;

      // Fetch the event to check permissions
      const event = await ctx.db.query.events.findFirst({
        where: eq(events.id, eventId),
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      // Check if user is admin
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
      });

      const isAdmin = user?.role === "admin";
      const isCreator = event.createdByUserId === ctx.auth.userId;

      // Only admins or the event creator can edit
      if (!isAdmin && !isCreator) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to edit this event",
        });
      }

      // Validate startAt < endAt if both are provided
      const startAt = updates.startAt || event.startAt;
      const endAt = updates.endAt || event.endAt;

      if (endAt && startAt >= endAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "End time must be after start time",
        });
      }

      // Build update object
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      };

      if (updates.title !== undefined) updateData.title = updates.title;
      if (updates.description !== undefined)
        updateData.description = updates.description;
      if (updates.coverImageUrl !== undefined)
        updateData.coverImageUrl = updates.coverImageUrl;
      if (updates.eventUrl !== undefined)
        updateData.eventUrl = updates.eventUrl;
      if (updates.source !== undefined) updateData.source = updates.source;
      if (updates.externalId !== undefined)
        updateData.externalId = updates.externalId;
      if (updates.startAt !== undefined) updateData.startAt = updates.startAt;
      if (updates.endAt !== undefined) updateData.endAt = updates.endAt;
      if (updates.address !== undefined) updateData.address = updates.address;
      if (updates.city !== undefined) updateData.city = updates.city;
      if (updates.state !== undefined) updateData.state = updates.state;
      if (updates.visibility !== undefined)
        updateData.visibility = updates.visibility;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.venueId !== undefined) updateData.venueId = updates.venueId;
      if (updates.organizerId !== undefined)
        updateData.organizerId = updates.organizerId;

      // Update the event
      const [updatedEvent] = await ctx.db
        .update(events)
        .set(updateData)
        .where(eq(events.id, eventId))
        .returning();

      if (!updatedEvent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update event",
        });
      }

      if (updates.categories !== undefined) {
        await setEventCategoryKeys(ctx.db, eventId, updates.categories, {
          activeOnly: true,
        });
      }

      const refreshed = await ctx.db.query.events.findFirst({
        where: eq(events.id, eventId),
        with: {
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      const previousStatus = event.status as EventStatus;
      const nextStatus = (updatedEvent.status as EventStatus) ?? previousStatus;
      const startAtChanged =
        updates.startAt !== undefined &&
        event.startAt.getTime() !== updates.startAt.getTime();
      const activityType = resolveEventUpdateActivityType(
        previousStatus,
        nextStatus,
        startAtChanged
      );
      const changedFields = Object.keys({
        ...updates,
        ...(updates.categories !== undefined ? { categories: true } : {}),
      });

      void logEventActivity({
        actorUserId: ctx.auth.userId,
        eventId,
        type: activityType,
        metadata: {
          previousStatus,
          nextStatus,
          previousStartAt: event.startAt,
          nextStartAt: updatedEvent.startAt,
          changedFields,
        },
      });

      return refreshed ? mapEventCategoryData(refreshed) : updatedEvent;
    }),

  deleteEvent: protectedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const event = await ctx.db.query.events.findFirst({
        where: eq(events.id, input.eventId),
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
      });
      const isAdmin = user?.role === "admin";
      const isCreator = event.createdByUserId === ctx.auth.userId;

      if (!isAdmin && !isCreator) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to delete this event",
        });
      }

      if (event.seriesId) {
        const now = new Date();
        const deletedRecurringEvents = await ctx.db
          .delete(events)
          .where(
            and(
              eq(events.seriesId, event.seriesId),
              or(gte(events.startAt, now), eq(events.id, input.eventId))
            )
          )
          .returning({ id: events.id });

        if (deletedRecurringEvents.length === 0) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to delete recurring events",
          });
        }

        const seriesCutoff = new Date(now.getTime() - 1);
        await ctx.db
          .update(eventSeries)
          .set({
            isActive: false,
            untilDate: seriesCutoff,
            updatedAt: new Date(),
          })
          .where(eq(eventSeries.id, event.seriesId));

        return {
          success: true,
          deletedEvents: deletedRecurringEvents.length,
          deletedRecurring: true,
        };
      }

      const [deletedEvent] = await ctx.db
        .delete(events)
        .where(eq(events.id, input.eventId))
        .returning({ id: events.id });

      if (!deletedEvent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete event",
        });
      }

      return { success: true, deletedEvents: 1, deletedRecurring: false };
    }),

  listPublicEventsPreview: publicProcedure
    .input(
      z.object({
        search: z.string().optional(),
        city: z.string().optional(),
        limit: z.number().min(1).max(8).default(8),
      })
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();

      const conditions = [
        eq(events.visibility, "public"),
        gte(events.startAt, now),
      ];

      if (input.city) {
        // Look up metro area for coordinates and radius
        const metro = await ctx.db.query.metroAreas.findFirst({
          where: eq(metroAreas.name, input.city),
        });

        // Fall back to cities table if not a metro area
        const originCity =
          metro ??
          (await ctx.db.query.cities.findFirst({
            where: eq(cities.name, input.city),
          }));

        if (originCity?.latitude != null && originCity?.longitude != null) {
          const radiusMiles = metro?.radiusMiles ?? 20;

          const distanceSql = sql`
            (
              3959 * 2 * asin(
                sqrt(
                  pow(sin(radians(${originCity.latitude} - ${cities.latitude}) / 2), 2) +
                  cos(radians(${originCity.latitude})) * cos(radians(${cities.latitude})) *
                  pow(sin(radians(${originCity.longitude} - ${cities.longitude}) / 2), 2)
                )
              )
            )
          `;

          const nearbyEventIds = await ctx.db
            .select({ id: events.id })
            .from(events)
            .innerJoin(
              cities,
              and(eq(cities.name, events.city), eq(cities.state, events.state))
            )
            .where(
              and(
                eq(events.visibility, "public"),
                gte(events.startAt, now),
                sql`${distanceSql} <= ${radiusMiles}`
              )
            );

          if (nearbyEventIds.length === 0) {
            return [];
          }

          conditions.push(
            inArray(
              events.id,
              nearbyEventIds.map((row) => row.id)
            )
          );
        } else {
          conditions.push(eq(events.city, input.city));
        }
      }

      if (input.search) {
        conditions.push(ilike(events.title, `%${input.search}%`));
      }

      const eventList = await ctx.db.query.events.findMany({
        where: and(...conditions),
        orderBy: [events.startAt],
        limit: input.limit,
        with: {
          venue: true,
          organizer: true,
          createdBy: true,
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      return eventList.map((event) => ({
        ...mapEventCategoryData(event),
        userRsvp: null,
        friendsGoing: [] as never[],
      }));
    }),

  getMyEventActivity: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(25),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const currentUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
        columns: {
          eventUpdatesLastSeenAt: true,
        },
      });

      const subscribedRsvps = await ctx.db.query.eventRsvps.findMany({
        where: and(
          eq(eventRsvps.userId, ctx.auth.userId),
          inArray(eventRsvps.status, ["going", "interested"])
        ),
        columns: {
          eventId: true,
        },
      });

      const eventIds = [...new Set(subscribedRsvps.map((rsvp) => rsvp.eventId))];
      if (eventIds.length === 0) {
        return [];
      }

      const whereConditions = [inArray(eventActivity.eventId, eventIds)];
      if (currentUser?.eventUpdatesLastSeenAt) {
        whereConditions.push(
          gt(eventActivity.createdAt, currentUser.eventUpdatesLastSeenAt)
        );
      }

      return await ctx.db.query.eventActivity.findMany({
        where: and(...whereConditions),
        orderBy: [desc(eventActivity.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          actor: true,
          event: {
            with: {
              venue: true,
              organizer: true,
            },
          },
        },
      });
    }),

  getMyUnreadEventActivityCount: protectedProcedure.query(async ({ ctx }) => {
    const currentUser = await ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.auth.userId),
      columns: {
        eventUpdatesLastSeenAt: true,
      },
    });

    const subscribedRsvps = await ctx.db.query.eventRsvps.findMany({
      where: and(
        eq(eventRsvps.userId, ctx.auth.userId),
        inArray(eventRsvps.status, ["going", "interested"])
      ),
      columns: {
        eventId: true,
      },
    });

    const eventIds = [...new Set(subscribedRsvps.map((rsvp) => rsvp.eventId))];
    if (eventIds.length === 0) {
      return { unreadCount: 0 };
    }

    const whereConditions = [inArray(eventActivity.eventId, eventIds)];
    if (currentUser?.eventUpdatesLastSeenAt) {
      whereConditions.push(
        gt(eventActivity.createdAt, currentUser.eventUpdatesLastSeenAt)
      );
    }

    const [result] = await ctx.db
      .select({
        unreadCount: sql<number>`count(*)::int`,
      })
      .from(eventActivity)
      .where(and(...whereConditions));

    return { unreadCount: result?.unreadCount ?? 0 };
  }),

  markMyEventActivitySeen: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(users)
      .set({
        eventUpdatesLastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, ctx.auth.userId));

    return { success: true };
  }),

  getAvailableCities: publicProcedure.query(async ({ ctx }) => {
    // Return all metro areas from the database
    const metros = await ctx.db
      .select({
        city: metroAreas.name,
        state: metroAreas.state,
        latitude: metroAreas.latitude,
        longitude: metroAreas.longitude,
        radiusMiles: metroAreas.radiusMiles,
      })
      .from(metroAreas)
      .orderBy(metroAreas.name);

    return metros;
  }),

  getRecentlyAddedEvents: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(20).default(8),
        city: z.string().optional(),
        radiusMiles: z.number().min(1).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const currentUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
      });

      const now = new Date();

      const conditions = [
        eq(events.visibility, "public"),
        gte(events.startAt, now), // Only future events
      ];

      if (input.city) {
        // Look up metro area first for coordinates and radius
        const metro = await ctx.db.query.metroAreas.findFirst({
          where: eq(metroAreas.name, input.city),
        });

        let originCity: { latitude: number; longitude: number } | undefined;
        if (metro?.latitude != null && metro?.longitude != null) {
          originCity = { latitude: metro.latitude, longitude: metro.longitude };
        } else {
          const cityConditions = [eq(cities.name, input.city)];
          if (currentUser?.state) {
            cityConditions.push(eq(cities.state, currentUser.state));
          }
          let cityRecord = await ctx.db.query.cities.findFirst({
            where: and(...cityConditions),
          });
          if (!cityRecord && currentUser?.state) {
            cityRecord = await ctx.db.query.cities.findFirst({
              where: eq(cities.name, input.city),
            });
          }
          if (cityRecord?.latitude != null && cityRecord?.longitude != null) {
            originCity = {
              latitude: cityRecord.latitude,
              longitude: cityRecord.longitude,
            };
          }
        }

        if (originCity) {
          const radiusMiles = input.radiusMiles ?? metro?.radiusMiles ?? 20;

          const distanceSql = sql`
            (
              3959 * 2 * asin(
                sqrt(
                  pow(sin(radians(${originCity.latitude} - ${cities.latitude}) / 2), 2) +
                  cos(radians(${originCity.latitude})) * cos(radians(${cities.latitude})) *
                  pow(sin(radians(${originCity.longitude} - ${cities.longitude}) / 2), 2)
                )
              )
            )
          `;

          const nearbyEventIds = await ctx.db
            .select({ id: events.id })
            .from(events)
            .innerJoin(
              cities,
              and(eq(cities.name, events.city), eq(cities.state, events.state))
            )
            .where(
              and(
                eq(events.visibility, "public"),
                gte(events.startAt, now),
                sql`${distanceSql} <= ${radiusMiles}`
              )
            );

          if (nearbyEventIds.length === 0) {
            return [];
          }

          conditions.push(
            inArray(
              events.id,
              nearbyEventIds.map((row) => row.id)
            )
          );
        } else {
          conditions.push(eq(events.city, input.city));
        }
      }

      const recentEvents = await ctx.db.query.events.findMany({
        where: and(...conditions),
        orderBy: [desc(events.createdAt)],
        limit: input.limit,
        with: {
          venue: true,
          organizer: true,
          createdBy: true,
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      // Fetch user's RSVPs for these events
      const eventIds = recentEvents.map((e) => e.id);
      const userRsvps =
        eventIds.length > 0
          ? await ctx.db.query.eventRsvps.findMany({
              where: and(
                eq(eventRsvps.userId, ctx.auth.userId),
                inArray(eventRsvps.eventId, eventIds)
              ),
            })
          : [];

      // Create a map of event IDs to RSVPs
      const rsvpMap = new Map(userRsvps.map((r) => [r.eventId, r]));

      // currentUser already fetched above

      // Fetch user's friends
      const friendConnections = await ctx.db.query.userFriends.findMany({
        where: and(
          or(
            eq(userFriends.userId, ctx.auth.userId),
            eq(userFriends.friendUserId, ctx.auth.userId)
          ),
          eq(userFriends.status, "accepted")
        ),
      });

      const friendIds = friendConnections.map((f) =>
        f.userId === ctx.auth.userId ? f.friendUserId : f.userId
      );

      // Fetch friends' RSVPs (going status only)
      const friendsRsvps =
        eventIds.length > 0 && friendIds.length > 0
          ? await ctx.db.query.eventRsvps.findMany({
              where: and(
                inArray(eventRsvps.eventId, eventIds),
                inArray(eventRsvps.userId, friendIds),
                eq(eventRsvps.status, "going")
              ),
              with: {
                user: true,
              },
            })
          : [];

      // Create a map of event IDs to attendees
      const attendeesMap = new Map<string, typeof friendsRsvps>();

      // Add current user if they're going to any events
      for (const userRsvp of userRsvps) {
        if (userRsvp.status === "going" && currentUser) {
          if (!attendeesMap.has(userRsvp.eventId)) {
            attendeesMap.set(userRsvp.eventId, []);
          }
          attendeesMap.get(userRsvp.eventId)!.push({
            ...userRsvp,
            user: currentUser,
          } as any);
        }
      }

      // Add friends to the map
      for (const rsvp of friendsRsvps) {
        if (!attendeesMap.has(rsvp.eventId)) {
          attendeesMap.set(rsvp.eventId, []);
        }
        attendeesMap.get(rsvp.eventId)!.push(rsvp);
      }

      // Return events with userRsvp and friendsGoing attached
      return recentEvents.map((event) => ({
        ...mapEventCategoryData(event),
        userRsvp: rsvpMap.get(event.id) || null,
        friendsGoing: attendeesMap.get(event.id) || [],
      }));
    }),
});
