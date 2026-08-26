import { z } from "zod";
import {
  adminProcedure,
  contentMutationProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "../init";
import { assertTRPCTextContentAllowed } from "@/server/utils/content-moderation";
import {
  categories,
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
  gte,
  isNull,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  uploadImageFromUrl,
  deleteFromS3,
  isPendingStorageUrl,
  isStorageUrl,
} from "@/lib/s3";
import { TRPCError } from "@trpc/server";
import {
  clearRsvpActivity,
  upsertRsvpActivity,
} from "../../utils/activity-logger";
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
import {
  createNotification,
  notifyFriendsOfRsvp,
} from "@/server/utils/notifications";
import { sendPushNotificationToUsers } from "@/server/utils/push-notifications";
import { accentInsensitiveLike } from "@/server/db/search";
import { RSVP_DECLINE_REASON_VALUES } from "@/lib/rsvp";
import { generateNanoId } from "@/lib/nano-id";
import { isPublicId, publicOrUuidSchema } from "@/lib/public-id";
import {
  meaningfulScraperUpdatedAt,
  rehostExistingScrapedEventImages,
  rehostScrapedEventImage,
  SCRAPER_SOURCES,
  type ScraperSource,
} from "@/server/utils/scraped-event-images";
import { claimManualSeriesOccurrence } from "@/server/utils/scraper-event-reconciliation";
import { withStoredImageReplacements } from "@/server/utils/stored-image-lifecycle";

function resolveEventUpdateActivityType(
  previousStatus: EventStatus,
  nextStatus: EventStatus,
  startAtChanged: boolean
): "updated" | "cancelled" | "postponed" | "rescheduled" | "restored" {
  if (previousStatus !== nextStatus) {
    if (nextStatus === "cancelled") return "cancelled";
    if (nextStatus === "postponed") return "postponed";
    if (previousStatus !== "active" && nextStatus === "active")
      return "restored";
    return "updated";
  }

  if (startAtChanged) {
    return "rescheduled";
  }

  return "updated";
}

async function notifyPartnerOfMirroredRsvp({
  ctx,
  actorUserId,
  partnerUserId,
  eventId,
  status,
}: {
  ctx: any;
  actorUserId: string;
  partnerUserId: string;
  eventId: string;
  status: "going" | "interested";
}) {
  const [actor, event] = await Promise.all([
    ctx.db.query.users.findFirst({
      where: eq(users.id, actorUserId),
      columns: {
        firstName: true,
        lastName: true,
        username: true,
      },
    }),
    ctx.db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: {
        id: true,
        publicId: true,
        title: true,
        startAt: true,
      },
    }),
  ]);

  if (!event) return;

  const partnerRsvpDate = event.startAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(event.startAt)
    : null;
  const actorName =
    [actor?.firstName, actor?.lastName].filter(Boolean).join(" ").trim() ||
    actor?.username ||
    "Your partner";
  const title = actorName;
  const body =
    status === "going"
      ? `Is going with you to ${event.title}${partnerRsvpDate ? ` on ${partnerRsvpDate}` : ""}`
      : `Is interested in ${event.title} with you${partnerRsvpDate ? ` on ${partnerRsvpDate}` : ""}`;
  const actionUrl = `/event/${event.publicId}`;

  await createNotification(
    {
      userId: partnerUserId,
      actorUserId,
      type: "event_update",
      entityType: "event",
      entityId: event.id,
      title,
      body,
      actionUrl,
      metadata: {
        source: "partner_rsvp",
        status,
        eventId: event.id,
        eventTitle: event.title,
      },
    },
    ctx.db
  );

  await sendPushNotificationToUsers(
    [partnerUserId],
    {
      title,
      body,
      data: {
        type: "event_update",
        entityId: event.id,
        actionUrl,
        source: "partner_rsvp",
        status,
      },
    },
    ctx.db
  );
}

function isBucketUrl(url: string): boolean {
  return isStorageUrl(url);
}

function isLegacyEventCoverImageUrl(url: string, eventId: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      isStorageUrl(url) &&
      parsed.pathname.endsWith(`/events/${eventId}/coverImage.png`)
    );
  } catch {
    return false;
  }
}

async function cleanupPendingEventUpload(url: string): Promise<void> {
  if (!isPendingStorageUrl(url)) return;
  try {
    await deleteFromS3(url);
  } catch {
    // Ignore cleanup failures; the promoted image is already persisted.
  }
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
  createEvent: contentMutationProcedure
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
      assertTRPCTextContentAllowed([
        { field: "title", value: input.title },
        { field: "description", value: input.description },
      ]);

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
          publicId: generateNanoId(),
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
          // Never persist a temporary key. Older clients may still submit one;
          // it is promoted after the permanent event ID exists below.
          coverImageUrl:
            input.coverImageUrl && isPendingStorageUrl(input.coverImageUrl)
              ? null
              : (input.coverImageUrl ?? null),
          eventUrl: input.eventUrl ?? null,
          source: input.source ?? null,
          externalId: input.externalId ?? null,
          timeZone: input.timeZone ?? null,
        } as any)
        .returning();

      if (event && validCategories.length > 0) {
        await setEventCategoryKeys(ctx.db, event.id, validCategories, {
          activeOnly: true,
        });
      }

      if (event && input.coverImageUrl) {
        try {
          const originalCoverImageUrl = input.coverImageUrl;
          const eventCoverImageUrl = await uploadImageFromUrl(
            originalCoverImageUrl,
            `events/${event.id}/cover-images`,
            "cover-image.jpg"
          );

          await ctx.db
            .update(events)
            .set({ coverImageUrl: eventCoverImageUrl })
            .where(eq(events.id, event.id));

          await cleanupPendingEventUpload(originalCoverImageUrl);
        } catch {
          // A non-temporary external URL was already retained on insert. A
          // temporary URL is intentionally never persisted.
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

  createRecurringEvent: contentMutationProcedure
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
      assertTRPCTextContentAllowed([
        { field: "title", value: input.title },
        { field: "description", value: input.description },
      ]);

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
          publicId: generateNanoId(),
          title: input.title,
          description: input.description ?? null,
          // Never persist a temporary key. It is promoted once the permanent
          // series ID exists below.
          coverImageUrl:
            input.coverImageUrl && isPendingStorageUrl(input.coverImageUrl)
              ? null
              : (input.coverImageUrl ?? null),
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
        .returning({ id: eventSeries.id, publicId: eventSeries.publicId });

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
          const originalCoverImageUrl = resolvedCoverImageUrl;
          resolvedCoverImageUrl = await uploadImageFromUrl(
            originalCoverImageUrl,
            `event-series/${series.id}/cover-images`,
            "cover-image.jpg"
          );

          await ctx.db
            .update(eventSeries)
            .set({ coverImageUrl: resolvedCoverImageUrl })
            .where(eq(eventSeries.id, series.id));

          await cleanupPendingEventUpload(originalCoverImageUrl);
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
        seriesPublicId: series.publicId,
        createdEvents: generated.createdEvents,
        firstEventId: generated.firstCreatedEventId,
        firstEventPublicId: generated.firstCreatedEventPublicId,
      };
    }),

  setEventCoverImage: contentMutationProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        coverImageUrl: z.string().url().or(z.literal("")),
      })
    )
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
          message: "You do not have permission to edit this event",
        });
      }

      const nextCoverImageUrl =
        input.coverImageUrl === "" ? null : input.coverImageUrl;
      const [updatedEvent] = await withStoredImageReplacements({
        db: ctx.db,
        replacements: [
          { oldUrl: event.coverImageUrl, newUrl: nextCoverImageUrl },
        ],
        persist: () =>
          ctx.db
            .update(events)
            .set({ coverImageUrl: nextCoverImageUrl, updatedAt: new Date() })
            .where(eq(events.id, input.eventId))
            .returning({ id: events.id, coverImageUrl: events.coverImageUrl }),
      });

      if (!updatedEvent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update event cover image",
        });
      }

      return updatedEvent;
    }),

  getEventSeriesById: protectedProcedure
    .input(z.object({ seriesId: publicOrUuidSchema }))
    .query(async ({ ctx, input }) => {
      const series = await ctx.db.query.eventSeries.findFirst({
        where: isPublicId(input.seriesId)
          ? eq(eventSeries.publicId, input.seriesId)
          : eq(eventSeries.id, input.seriesId),
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

  updateEventSeries: contentMutationProcedure
    .input(
      z.object({
        seriesId: z.string().uuid(),
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        coverImageUrl: z.string().url().optional().or(z.literal("")),
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
      assertTRPCTextContentAllowed([
        { field: "title", value: input.title },
        { field: "description", value: input.description },
      ]);

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

      const nextSeriesTimeZone =
        input.timeZone !== undefined ? input.timeZone : existingSeries.timeZone;

      const normalizedDaysOfWeek = normalizeSeriesDaysOfWeek(
        input.recurrence.frequency,
        input.recurrence.daysOfWeek,
        input.startAt,
        nextSeriesTimeZone
      );

      const seriesImageWasRemoved =
        input.coverImageUrl === "" && existingSeries.coverImageUrl !== null;
      const submittedPendingCover =
        Boolean(input.coverImageUrl) &&
        isPendingStorageUrl(input.coverImageUrl!);

      const [updatedSeries] = await ctx.db
        .update(eventSeries)
        .set({
          title: input.title,
          description: input.description ?? null,
          coverImageUrl:
            input.coverImageUrl === ""
              ? null
              : submittedPendingCover
                ? existingSeries.coverImageUrl
                : input.coverImageUrl !== undefined
                  ? input.coverImageUrl
                  : existingSeries.coverImageUrl,
          eventUrl:
            input.eventUrl !== undefined
              ? input.eventUrl
              : existingSeries.eventUrl,
          source:
            input.source !== undefined ? input.source : existingSeries.source,
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

      await setEventSeriesCategoryKeys(
        ctx.db,
        input.seriesId,
        validCategories,
        {
          activeOnly: true,
        }
      );

      if (input.coverImageUrl && submittedPendingCover) {
        try {
          const originalCoverImageUrl = input.coverImageUrl;
          const seriesCoverImageUrl = await uploadImageFromUrl(
            originalCoverImageUrl,
            `event-series/${input.seriesId}/cover-images`,
            "cover-image.jpg"
          );

          await ctx.db
            .update(eventSeries)
            .set({ coverImageUrl: seriesCoverImageUrl })
            .where(eq(eventSeries.id, input.seriesId));

          await cleanupPendingEventUpload(originalCoverImageUrl);
        } catch {
          // Keep existing cover image URL if re-hosting fails.
        }
      }

      const now = new Date();
      const futureEventsBeforeUpdate = await ctx.db.query.events.findMany({
        where: and(
          eq(events.seriesId, input.seriesId),
          gte(events.startAt, now)
        ),
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
          and(
            eq(events.seriesId, input.seriesId),
            gte(events.startAt, now),
            isNull(events.externalId)
          )
        );

      const generated = await materializeEventSeries(ctx.db, {
        seriesIds: [input.seriesId],
        now,
        ...(input.recurrence.untilDate
          ? { windowEnd: input.recurrence.untilDate }
          : {}),
      });

      const nextEvent = await ctx.db.query.events.findFirst({
        where: and(
          eq(events.seriesId, input.seriesId),
          gte(events.startAt, now)
        ),
        orderBy: [asc(events.startAt)],
        columns: { id: true },
      });

      if (customCoverImageByStartAt.size > 0) {
        const regeneratedEvents = await ctx.db.query.events.findMany({
          where: and(
            eq(events.seriesId, input.seriesId),
            gte(events.startAt, now)
          ),
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

      if (seriesImageWasRemoved && existingSeries.coverImageUrl) {
        await ctx.db
          .update(events)
          .set({ coverImageUrl: null })
          .where(
            and(
              eq(events.seriesId, input.seriesId),
              eq(events.coverImageUrl, existingSeries.coverImageUrl)
            )
          );
      }

      const finalSeries = await ctx.db.query.eventSeries.findFirst({
        where: eq(eventSeries.id, input.seriesId),
        columns: { coverImageUrl: true },
      });
      await withStoredImageReplacements({
        db: ctx.db,
        replacements: [
          {
            oldUrl: existingSeries.coverImageUrl,
            newUrl: finalSeries?.coverImageUrl,
          },
        ],
        persist: async () => undefined,
      });

      return {
        seriesId: input.seriesId,
        createdEvents: generated.createdEvents,
        firstEventId: nextEvent?.id ?? generated.firstCreatedEventId,
      };
    }),

  setEventSeriesCoverImage: contentMutationProcedure
    .input(
      z.object({
        seriesId: z.string().uuid(),
        coverImageUrl: z.string().url().or(z.literal("")),
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

      const nextCoverImageUrl =
        input.coverImageUrl === ""
          ? null
          : isPendingStorageUrl(input.coverImageUrl)
            ? await uploadImageFromUrl(
                input.coverImageUrl,
                `event-series/${input.seriesId}/cover-images`,
                "cover-image.jpg"
              )
            : input.coverImageUrl;
      const inheritedImageCondition =
        existingSeries.coverImageUrl === null
          ? isNull(events.coverImageUrl)
          : or(
              isNull(events.coverImageUrl),
              eq(events.coverImageUrl, existingSeries.coverImageUrl)
            );

      const updatedSeries = await withStoredImageReplacements({
        db: ctx.db,
        replacements: [
          {
            oldUrl: existingSeries.coverImageUrl,
            newUrl: nextCoverImageUrl,
          },
        ],
        persist: async () => {
          const [updated] = await ctx.db
            .update(eventSeries)
            .set({ coverImageUrl: nextCoverImageUrl, updatedAt: new Date() })
            .where(eq(eventSeries.id, input.seriesId))
            .returning({
              id: eventSeries.id,
              coverImageUrl: eventSeries.coverImageUrl,
            });

          if (!updated) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to update recurring event series cover image",
            });
          }

          await ctx.db
            .update(events)
            .set({ coverImageUrl: nextCoverImageUrl, updatedAt: new Date() })
            .where(
              and(eq(events.seriesId, input.seriesId), inheritedImageCondition)
            );
          return updated;
        },
      });

      if (input.coverImageUrl && isPendingStorageUrl(input.coverImageUrl)) {
        await cleanupPendingEventUpload(input.coverImageUrl);
      }

      return updatedSeries;
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
            timeZone: z.string().min(1).max(64).optional(),
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

      const scraperSources = Array.from(
        new Set(
          input.events
            .map((event) => event.source)
            .filter(
              (source): source is ScraperSource =>
                Boolean(source) &&
                SCRAPER_SOURCES.includes(source as ScraperSource)
            )
        )
      );
      await rehostExistingScrapedEventImages(scraperSources);

      const reconciledEvents = await Promise.all(
        input.events.map(async (event) => {
          const venueId = event.venueId ?? input.venueId;
          const organizerId = event.organizerId ?? input.organizerId;
          if (!event.source || !event.externalId || !venueId) return event;

          const externalIdMatch = await ctx.db.query.events.findFirst({
            where: and(
              eq(events.source, event.source),
              eq(events.externalId, event.externalId)
            ),
            columns: { id: true },
          });
          if (externalIdMatch) return event;

          const sameSlot = await ctx.db.query.events.findFirst({
            where: and(
              eq(events.venueId, venueId),
              eq(events.startAt, event.startAt),
              event.endAt ? eq(events.endAt, event.endAt) : isNull(events.endAt)
            ),
            columns: { id: true, source: true, externalId: true },
            orderBy: [asc(events.createdAt)],
          });
          if (!sameSlot?.externalId) {
            if (organizerId) {
              const claimedId = await claimManualSeriesOccurrence({
                db: ctx.db,
                venueId,
                source: event.source,
                externalId: event.externalId,
                startAt: event.startAt,
                title: event.title,
                description: event.description,
                coverImageUrl: event.coverImageUrl,
                eventUrl: event.eventUrl,
                timeZone: event.timeZone,
                endAt: event.endAt,
                address: event.address,
                city: event.city,
                state: event.state,
                organizerId,
              });
              if (claimedId && event.categories.length > 0) {
                const categoryKeys = await filterExistingCategoryKeys(
                  ctx.db,
                  event.categories,
                  { activeOnly: true }
                );
                await setEventCategoryKeys(ctx.db, claimedId, categoryKeys, {
                  activeOnly: true,
                });
              }
              if (claimedId && event.coverImageUrl) {
                await rehostScrapedEventImage(
                  claimedId,
                  event.coverImageUrl,
                  event.coverImageUrl,
                  event.coverImageUrl
                );
              }
            }
            return event;
          }

          if (organizerId) {
            await ctx.db
              .update(events)
              .set({ source: event.source, externalId: event.externalId })
              .where(eq(events.id, sameSlot.id));
            return event;
          }

          return {
            ...event,
            source: sameSlot.source ?? event.source,
            externalId: sameSlot.externalId,
          };
        })
      );

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

      let dedupedEvents = reconciledEvents;

      if (!input.overrideExisting) {
        const eventsWithExternal = reconciledEvents.filter(
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

        await Promise.all(
          reconciledEvents
            .filter(
              (event) =>
                event.source &&
                event.externalId &&
                (event.organizerId || input.organizerId)
            )
            .map((event) =>
              ctx.db
                .update(events)
                .set({
                  title: event.title,
                  description: event.description ?? null,
                  eventUrl: event.eventUrl ?? null,
                  endAt: event.endAt ?? null,
                  venueId: event.venueId ?? input.venueId ?? null,
                  organizerId: event.organizerId ?? input.organizerId!,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(events.source, event.source!),
                    eq(events.externalId, event.externalId!)
                  )
                )
            )
        );

        const seenKeys = new Set<string>();
        dedupedEvents = reconciledEvents.filter((event) => {
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
            publicId: generateNanoId(),
            title: event.title,
            description: event.description ?? null,
            coverImageUrl: event.coverImageUrl ?? null,
            sourceImageUrl: event.coverImageUrl ?? null,
            eventUrl: event.eventUrl ?? null,
            source: event.source ?? null,
            externalId: event.externalId ?? null,
            startAt: event.startAt,
            timeZone: event.timeZone ?? null,
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

      const upserted = await (
        input.overrideExisting
          ? insertQuery.onConflictDoUpdate({
              target: [events.source, events.externalId],
              set: {
                title: sql`excluded.title`,
                description: sql`excluded.description`,
                coverImageUrl: sql`case
                  when ${events.sourceImageUrl} is not null
                    and ${events.sourceImageUrl} is distinct from excluded.source_image_url
                  then excluded.cover_image
                  else ${events.coverImageUrl}
                end`,
                sourceImageUrl: sql`excluded.source_image_url`,
                eventUrl: sql`excluded.event_url`,
                startAt: sql`excluded.start_at`,
                timeZone: sql`excluded.time_zone`,
                endAt: sql`excluded.end_at`,
                address: sql`excluded.address`,
                city: sql`excluded.city`,
                state: sql`excluded.state`,
                venueId: sql`excluded.venue_id`,
                updatedAt: meaningfulScraperUpdatedAt(),
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

      // Re-upload external covers to immutable events/{id}/cover-images/{nanoId}.jpg keys.
      await Promise.allSettled(
        upserted.map(async (row) => {
          if (!row.coverImageUrl) {
            return;
          }

          const isLegacyS3Key = isLegacyEventCoverImageUrl(
            row.coverImageUrl,
            row.id
          );
          if (isBucketUrl(row.coverImageUrl) && !isLegacyS3Key) {
            return;
          }

          if (!isBucketUrl(row.coverImageUrl)) {
            await rehostScrapedEventImage(
              row.id,
              row.sourceImageUrl ?? row.coverImageUrl,
              row.coverImageUrl,
              row.sourceImageUrl
            );
            return;
          }

          try {
            const s3Url = await uploadImageFromUrl(
              row.coverImageUrl,
              `events/${row.id}/cover-images`,
              "cover-image.jpg"
            );
            await ctx.db
              .update(events)
              .set({ coverImageUrl: s3Url })
              .where(eq(events.id, row.id));

            if (isLegacyS3Key) {
              await deleteFromS3(row.coverImageUrl);
            }
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
        friendsRsvpOnly: z.boolean().default(false),
        myRsvpOnly: z.boolean().default(false),
        rsvpStatusFilter: z.enum(["going", "interested"]).optional(),
        category: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        radiusMiles: z.number().min(1).max(200).optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(500).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const currentUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
      });
      const userPlaceFollows = await ctx.db.query.placeFollows.findMany({
        where: eq(placeFollows.userId, ctx.auth.userId),
        columns: { placeId: true },
      });
      const followedPlaceIdSet = new Set(
        userPlaceFollows.map((follow) => follow.placeId)
      );

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
      if (input.search?.trim()) {
        const searchQuery = input.search.trim();
        const matchingVenueRows = await ctx.db
          .select({ id: places.id })
          .from(places)
          .where(
            and(
              eq(places.type, "venue"),
              accentInsensitiveLike(places.name, searchQuery)
            )
          );

        const searchConditions = [
          accentInsensitiveLike(events.title, searchQuery),
        ];

        if (matchingVenueRows.length > 0) {
          searchConditions.push(
            inArray(
              events.venueId,
              matchingVenueRows.map((row) => row.id)
            )
          );
        }

        conditions.push(or(...searchConditions)!);
      }

      // Filter by followed places (venues and organizers)
      if (input.followedOnly) {
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

      // Filter by events friends have RSVP'd to
      if (input.friendsGoingOnly || input.friendsRsvpOnly) {
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
              input.friendsRsvpOnly
                ? inArray(eventRsvps.status, ["going", "interested"])
                : eq(eventRsvps.status, "going")
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

      if (input.rsvpStatusFilter) {
        const userRsvps = await ctx.db.query.eventRsvps.findMany({
          where: and(
            eq(eventRsvps.userId, ctx.auth.userId),
            eq(eventRsvps.status, input.rsvpStatusFilter)
          ),
          columns: {
            eventId: true,
          },
        });

        const eventIds = [...new Set(userRsvps.map((rsvp) => rsvp.eventId))];

        if (eventIds.length > 0) {
          conditions.push(inArray(events.id, eventIds));
        } else {
          return [];
        }
      }

      if (input.myRsvpOnly) {
        const userRsvps = await ctx.db.query.eventRsvps.findMany({
          where: and(
            eq(eventRsvps.userId, ctx.auth.userId),
            inArray(eventRsvps.status, ["going", "interested"])
          ),
          columns: {
            eventId: true,
          },
        });

        const eventIds = [...new Set(userRsvps.map((rsvp) => rsvp.eventId))];

        if (eventIds.length > 0) {
          conditions.push(inArray(events.id, eventIds));
        } else {
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

      const mirroredPartnerRsvps =
        eventIds.length > 0
          ? await ctx.db.query.eventRsvps.findMany({
              where: and(
                inArray(eventRsvps.eventId, eventIds),
                eq(eventRsvps.partnerRsvpByUserId, ctx.auth.userId),
                inArray(eventRsvps.status, ["going", "interested"])
              ),
              with: {
                user: true,
              },
            })
          : [];

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

      // Fetch friends' RSVPs that should appear in the social stack
      const friendsRsvps =
        eventIds.length > 0 && friendIds.length > 0
          ? await ctx.db.query.eventRsvps.findMany({
              where: and(
                inArray(eventRsvps.eventId, eventIds),
                inArray(eventRsvps.userId, friendIds),
                inArray(eventRsvps.status, ["going", "interested"])
              ),
              with: {
                user: true,
              },
            })
          : [];

      // Create a map of event IDs to social RSVPs (current user + friends)
      const socialRsvpsMap = new Map<string, typeof friendsRsvps>();
      const addSocialRsvp = (
        eventId: string,
        attendee: (typeof friendsRsvps)[number]
      ) => {
        if (!socialRsvpsMap.has(eventId)) {
          socialRsvpsMap.set(eventId, []);
        }

        const attendees = socialRsvpsMap.get(eventId)!;
        const existingIndex = attendees.findIndex(
          (existing) => existing.userId === attendee.userId
        );

        if (existingIndex >= 0) {
          const existing = attendees[existingIndex];
          if (existing.status === "interested" && attendee.status === "going") {
            attendees[existingIndex] = attendee;
          }
          return;
        }

        attendees.push(attendee);
      };

      // Add current user if they've RSVP'd to any events
      for (const userRsvp of userRsvps) {
        if (
          (userRsvp.status === "going" || userRsvp.status === "interested") &&
          currentUser
        ) {
          addSocialRsvp(userRsvp.eventId, {
            ...userRsvp,
            user: currentUser,
          } as any);
        }
      }

      // Add mirrored partner RSVPs for the current user
      for (const rsvp of mirroredPartnerRsvps) {
        addSocialRsvp(rsvp.eventId, rsvp);
      }

      // Add friends to the map
      for (const rsvp of friendsRsvps) {
        addSocialRsvp(rsvp.eventId, rsvp);
      }

      // Attach user RSVP and social friend activity to each event

      return eventList.map((event) => ({
        ...mapEventCategoryData(event),
        isFollowed:
          (event.venueId ? followedPlaceIdSet.has(event.venueId) : false) ||
          (event.organizerId
            ? followedPlaceIdSet.has(event.organizerId)
            : false),
        userRsvp: rsvpMap.get(event.id) || null,
        friendsGoing:
          (socialRsvpsMap.get(event.id) || []).filter(
            (rsvp) => rsvp.status === "going"
          ) || [],
        friendsInterested:
          (socialRsvpsMap.get(event.id) || []).filter(
            (rsvp) => rsvp.status === "interested"
          ) || [],
      }));
    }),

  getEventById: protectedProcedure
    .input(z.object({ eventId: publicOrUuidSchema }))
    .query(async ({ ctx, input }) => {
      const event = await ctx.db.query.events.findFirst({
        where: isPublicId(input.eventId)
          ? eq(events.publicId, input.eventId)
          : eq(events.id, input.eventId),
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

      if (event.visibility !== "public" && !ctx.auth.userId) {
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
            eq(eventRsvps.eventId, event.id),
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
      z
        .object({
          eventId: z.string().uuid(),
          status: z.enum(["going", "interested", "not_going"]),
          includePartner: z.boolean().optional(),
          reason: z.enum(RSVP_DECLINE_REASON_VALUES).nullable().optional(),
        })
        .superRefine((value, ctx) => {
          if (value.status !== "not_going" && value.reason != null) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "A decline reason can only be set for can't go RSVPs",
              path: ["reason"],
            });
          }
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
        Boolean(partnerUserId) && input.includePartner === true;
      const shouldNotifyPartner =
        Boolean(partnerUserId) &&
        shouldMirrorPartnerRsvp &&
        (input.status === "going" || input.status === "interested") &&
        existingMirroredPartnerRsvp?.status !== input.status;
      const notGoingReason =
        input.status === "not_going" ? (input.reason ?? null) : null;
      let includedPartnerInRsvp = false;

      // Upsert RSVP
      const [rsvp] = await ctx.db
        .insert(eventRsvps)
        .values({
          userId: ctx.auth.userId,
          eventId: input.eventId,
          status: input.status,
          notGoingReason,
          partnerRsvpByUserId: null,
        })
        .onConflictDoUpdate({
          target: [eventRsvps.userId, eventRsvps.eventId],
          set: {
            status: input.status,
            notGoingReason,
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
            includedPartnerInRsvp = true;
            await ctx.db
              .insert(eventRsvps)
              .values({
                userId: partnerUserId,
                eventId: input.eventId,
                status: input.status,
                notGoingReason,
                partnerRsvpByUserId: ctx.auth.userId,
              })
              .onConflictDoUpdate({
                target: [eventRsvps.userId, eventRsvps.eventId],
                set: {
                  status: input.status,
                  notGoingReason,
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

      if (
        shouldNotifyPartner &&
        partnerUserId &&
        (input.status === "going" || input.status === "interested")
      ) {
        await notifyPartnerOfMirroredRsvp({
          ctx,
          actorUserId: ctx.auth.userId,
          partnerUserId,
          eventId: input.eventId,
          status: input.status,
        });
      }

      if (rsvp && (input.status === "going" || input.status === "interested")) {
        const activityType =
          input.status === "going" ? "rsvp_going" : "rsvp_interested";
        const activityMetadata = {
          status: input.status,
          includePartner: includedPartnerInRsvp,
        };
        await upsertRsvpActivity({
          actorUserId: ctx.auth.userId,
          entityId: input.eventId,
          type: activityType,
          metadata: activityMetadata,
        });

        if (existingUserRsvp?.status !== input.status) {
          await notifyFriendsOfRsvp(
            {
              actorUserId: ctx.auth.userId,
              eventId: input.eventId,
              status: input.status,
              partnerUserId: includedPartnerInRsvp ? partnerUserId : null,
            },
            ctx.db
          );
        }
      } else if (input.status === "not_going") {
        await upsertRsvpActivity({
          actorUserId: ctx.auth.userId,
          entityId: input.eventId,
          type: "rsvp_not_going",
          metadata: {
            includePartner: includedPartnerInRsvp,
            reason: notGoingReason,
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

      if (existingUserRsvp) {
        await clearRsvpActivity({
          actorUserId: ctx.auth.userId,
          entityId: input.eventId,
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
      const event = await ctx.db.query.events.findFirst({
        where: eq(events.id, input.eventId),
        columns: {
          visibility: true,
        },
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      if (event.visibility !== "public" && !ctx.auth.userId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

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

  updateEvent: contentMutationProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        coverImageUrl: z.string().url().optional().or(z.literal("")),
        eventUrl: z.string().url().optional(),
        source: z.string().max(50).optional(),
        externalId: z.string().optional(),
        startAt: z.date().optional(),
        timeZone: z.string().min(1).max(64).optional().nullable(),
        endAt: z.date().optional(),
        address: z.string().optional(),
        city: z.string().min(1).max(100).optional(),
        state: z.string().length(2).optional(),
        categories: z.array(z.string()).optional(),
        visibility: z.enum(["public", "private"]).optional(),
        status: z.enum(EVENT_STATUS_VALUES).optional(),
        venueId: z.string().uuid().optional(),
        organizerId: z.string().uuid().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertTRPCTextContentAllowed([
        { field: "title", value: input.title },
        { field: "description", value: input.description },
      ]);

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
        updateData.coverImageUrl =
          updates.coverImageUrl === "" ? null : updates.coverImageUrl;
      if (updates.eventUrl !== undefined)
        updateData.eventUrl = updates.eventUrl;
      if (updates.source !== undefined) updateData.source = updates.source;
      if (updates.externalId !== undefined)
        updateData.externalId = updates.externalId;
      if (updates.startAt !== undefined) updateData.startAt = updates.startAt;
      if (updates.timeZone !== undefined)
        updateData.timeZone = updates.timeZone;
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

      const nextCoverImageUrl =
        updates.coverImageUrl === undefined
          ? event.coverImageUrl
          : updates.coverImageUrl || null;
      const [updatedEvent] = await withStoredImageReplacements({
        db: ctx.db,
        replacements: [
          { oldUrl: event.coverImageUrl, newUrl: nextCoverImageUrl },
        ],
        persist: () =>
          ctx.db
            .update(events)
            .set(updateData)
            .where(eq(events.id, eventId))
            .returning(),
      });

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

  listPublicEventsByRange: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        city: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        startDate: z.date(),
        endDate: z.date(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(events.visibility, "public"),
        gte(events.startAt, input.startDate),
        lte(events.startAt, input.endDate),
      ];

      if (input.city) {
        const metro = await ctx.db.query.metroAreas.findFirst({
          where: eq(metroAreas.name, input.city),
        });

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
                gte(events.startAt, input.startDate),
                lte(events.startAt, input.endDate),
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

      if (input.search?.trim()) {
        const searchQuery = input.search.trim();
        const matchingVenueRows = await ctx.db
          .select({ id: places.id })
          .from(places)
          .where(
            and(
              eq(places.type, "venue"),
              accentInsensitiveLike(places.name, searchQuery)
            )
          );

        const searchConditions = [
          accentInsensitiveLike(events.title, searchQuery),
        ];

        if (matchingVenueRows.length > 0) {
          searchConditions.push(
            inArray(
              events.venueId,
              matchingVenueRows.map((row) => row.id)
            )
          );
        }

        conditions.push(or(...searchConditions)!);
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
        friendsInterested: [] as never[],
      }));
    }),

  listPublicEventsPreview: publicProcedure
    .input(
      z.object({
        search: z.string().optional(),
        city: z.string().optional(),
        limit: z.number().min(1).max(32).default(8),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const startDate = input.startDate ?? new Date();

      const conditions = [
        eq(events.visibility, "public"),
        gte(events.startAt, startDate),
      ];

      if (input.endDate) {
        conditions.push(lte(events.startAt, input.endDate));
      }

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

          const nearbyEventConditions = [
            eq(events.visibility, "public"),
            gte(events.startAt, startDate),
            sql`${distanceSql} <= ${radiusMiles}`,
          ];

          if (input.endDate) {
            nearbyEventConditions.push(lte(events.startAt, input.endDate));
          }

          const nearbyEventIds = await ctx.db
            .select({ id: events.id })
            .from(events)
            .innerJoin(
              cities,
              and(eq(cities.name, events.city), eq(cities.state, events.state))
            )
            .where(and(...nearbyEventConditions));

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

      if (input.search?.trim()) {
        const searchQuery = input.search.trim();
        const matchingVenueRows = await ctx.db
          .select({ id: places.id })
          .from(places)
          .where(
            and(
              eq(places.type, "venue"),
              accentInsensitiveLike(places.name, searchQuery)
            )
          );

        const searchConditions = [
          accentInsensitiveLike(events.title, searchQuery),
        ];

        if (matchingVenueRows.length > 0) {
          searchConditions.push(
            inArray(
              events.venueId,
              matchingVenueRows.map((row) => row.id)
            )
          );
        }

        conditions.push(or(...searchConditions)!);
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
        friendsInterested: [] as never[],
      }));
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

      const mirroredPartnerRsvps =
        eventIds.length > 0
          ? await ctx.db.query.eventRsvps.findMany({
              where: and(
                inArray(eventRsvps.eventId, eventIds),
                eq(eventRsvps.partnerRsvpByUserId, ctx.auth.userId),
                eq(eventRsvps.status, "going")
              ),
              with: {
                user: true,
              },
            })
          : [];

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
      const addAttendee = (
        eventId: string,
        attendee: (typeof friendsRsvps)[number]
      ) => {
        if (!attendeesMap.has(eventId)) {
          attendeesMap.set(eventId, []);
        }

        const attendees = attendeesMap.get(eventId)!;
        if (attendees.some((existing) => existing.userId === attendee.userId)) {
          return;
        }

        attendees.push(attendee);
      };

      // Add current user if they're going to any events
      for (const userRsvp of userRsvps) {
        if (userRsvp.status === "going" && currentUser) {
          addAttendee(userRsvp.eventId, {
            ...userRsvp,
            user: currentUser,
          } as any);
        }
      }

      // Add mirrored partner RSVPs for the current user
      for (const rsvp of mirroredPartnerRsvps) {
        addAttendee(rsvp.eventId, rsvp);
      }

      // Add friends to the map
      for (const rsvp of friendsRsvps) {
        addAttendee(rsvp.eventId, rsvp);
      }

      // Return events with userRsvp and friendsGoing attached
      return recentEvents.map((event) => ({
        ...mapEventCategoryData(event),
        userRsvp: rsvpMap.get(event.id) || null,
        friendsGoing: attendeesMap.get(event.id) || [],
        friendsInterested: [] as never[],
      }));
    }),
});
