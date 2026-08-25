import { auth } from "@clerk/nextjs/server";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { EVENT_STATUS_VALUES } from "@/lib/event-status";
import { eventTimeZone } from "@/lib/utils";
import { db } from "@/server/db";
import { generateNanoId } from "@/lib/nano-id";
import { eventSeries, users } from "@/server/db/schema";
import {
  filterExistingCategoryKeys,
  setEventSeriesCategoryKeys,
} from "@/server/utils/categories";
import { logEventActivity } from "@/server/utils/event-activity-logger";
import {
  materializeEventSeries,
  normalizeSeriesDaysOfWeek,
} from "@/server/utils/event-series";
import { resolveMobileEventEditPermissions } from "@/app/api/mobile/event-edit-permissions";
import {
  deleteFromS3,
  isPendingStorageUrl,
  uploadImageFromUrl,
} from "@/lib/s3";
import {
  enforceMobileContentCreation,
  mobileContentModerationErrorResponse,
} from "@/app/api/mobile/content-moderation";

const mobileCreateEventSeriesSchema = z.object({
  venueId: z.string().uuid().optional(),
  organizerId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().optional(),
  coverImageUrl: z.string().url().optional(),
  eventUrl: z.string().url().optional(),
  startAt: z.string().min(1),
  endAt: z.string().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2),
  categories: z.array(z.string()).optional().default([]),
  status: z.enum(EVENT_STATUS_VALUES).default("active"),
  timeZone: z.string().trim().min(1).max(64).optional(),
  recurrence: z.object({
    frequency: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(12).default(1),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    untilDate: z.string().optional(),
  }),
});

function parseDateValue(value: string | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function currentMobileUserContext() {
  const { userId } = await auth();

  if (userId) {
    return { userId, isPreview: false };
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: {
      id: true,
    },
  });

  return {
    userId: previewUser?.id ?? null,
    isPreview: true,
  };
}

export async function POST(request: Request) {
  try {
    const { userId, isPreview } = await currentMobileUserContext();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = mobileCreateEventSeriesSchema.parse(await request.json());
    await enforceMobileContentCreation(userId, [
      { field: "title", value: body.title },
      { field: "description", value: body.description },
    ]);

    const startAt = parseDateValue(body.startAt);
    const endAt = parseDateValue(body.endAt);
    const untilDate = parseDateValue(body.recurrence.untilDate);

    if (!startAt) {
      return NextResponse.json(
        { error: "Please choose a valid start time" },
        { status: 400 }
      );
    }

    if (endAt && endAt <= startAt) {
      return NextResponse.json(
        { error: "End time must be after start time" },
        { status: 400 }
      );
    }

    if (untilDate && untilDate < startAt) {
      return NextResponse.json(
        { error: "Series end date must be on or after the start date" },
        { status: 400 }
      );
    }

    if (
      body.recurrence.frequency === "weekly" &&
      (!body.recurrence.daysOfWeek || body.recurrence.daysOfWeek.length === 0)
    ) {
      return NextResponse.json(
        { error: "Select at least one weekday for a weekly recurrence" },
        { status: 400 }
      );
    }

    if (!isPreview) {
      const permissions = await resolveMobileEventEditPermissions(userId);

      if (
        body.venueId &&
        !permissions.isAdmin &&
        !permissions.manageablePlaceIds.has(body.venueId)
      ) {
        return NextResponse.json(
          { error: "You are not a member of this venue" },
          { status: 403 }
        );
      }

      if (
        body.organizerId &&
        !permissions.isAdmin &&
        !permissions.manageablePlaceIds.has(body.organizerId)
      ) {
        return NextResponse.json(
          { error: "You are not a member of this organizer" },
          { status: 403 }
        );
      }
    }

    const cleanedTitle = body.title.trim();
    const cleanedCity = body.city.trim();
    const cleanedState = body.state.trim().toUpperCase();
    const cleanedDescription = body.description?.trim() || null;
    const cleanedCoverImageUrl = body.coverImageUrl?.trim() || null;
    const submittedPendingCover =
      cleanedCoverImageUrl !== null &&
      isPendingStorageUrl(cleanedCoverImageUrl);
    const cleanedAddress = body.address?.trim() || null;
    const cleanedEventUrl = body.eventUrl?.trim() || null;
    const resolvedTimeZone =
      body.timeZone?.trim() || eventTimeZone(undefined, cleanedState) || null;
    const validCategories = await filterExistingCategoryKeys(
      db,
      body.categories,
      { activeOnly: true }
    );
    const durationMinutes = endAt
      ? Math.floor((endAt.getTime() - startAt.getTime()) / 60000)
      : null;
    const normalizedDaysOfWeek = normalizeSeriesDaysOfWeek(
      body.recurrence.frequency,
      body.recurrence.daysOfWeek,
      startAt,
      resolvedTimeZone
    );

    const [series] = await db
      .insert(eventSeries)
      .values({
        publicId: generateNanoId(),
        title: cleanedTitle,
        description: cleanedDescription,
        coverImageUrl: submittedPendingCover ? null : cleanedCoverImageUrl,
        eventUrl: cleanedEventUrl,
        startAt,
        durationMinutes,
        address: cleanedAddress,
        city: cleanedCity,
        state: cleanedState,
        visibility: "public",
        status: body.status,
        frequency: body.recurrence.frequency,
        interval: body.recurrence.interval,
        daysOfWeek: normalizedDaysOfWeek,
        timeZone: resolvedTimeZone,
        untilDate,
        venueId: body.venueId ?? null,
        organizerId: body.organizerId ?? null,
        createdByUserId: userId,
      })
      .returning({ id: eventSeries.id, publicId: eventSeries.publicId });

    if (!series) {
      return NextResponse.json(
        { error: "Failed to create event series" },
        { status: 500 }
      );
    }

    if (validCategories.length > 0) {
      await setEventSeriesCategoryKeys(db, series.id, validCategories, {
        activeOnly: true,
      });
    }

    if (submittedPendingCover && cleanedCoverImageUrl) {
      try {
        const finalCoverImageUrl = await uploadImageFromUrl(
          cleanedCoverImageUrl,
          `event-series/${series.id}/cover-images`,
          "cover-image.jpg"
        );
        await db
          .update(eventSeries)
          .set({ coverImageUrl: finalCoverImageUrl, updatedAt: new Date() })
          .where(eq(eventSeries.id, series.id));
        await deleteFromS3(cleanedCoverImageUrl).catch(() => undefined);
      } catch (error) {
        console.error("Failed to promote temporary series cover image", error);
        // The temporary URL is deliberately not persisted.
      }
    }

    const generated = await materializeEventSeries(db, {
      seriesIds: [series.id],
      ...(untilDate ? { windowEnd: untilDate } : {}),
    });

    if (generated.firstCreatedEventId) {
      void logEventActivity({
        actorUserId: userId,
        eventId: generated.firstCreatedEventId,
        type: "created",
        metadata: {
          recurring: true,
          seriesId: series.id,
          status: body.status,
          createdVia: "mobile",
        },
      });
    }

    return NextResponse.json({
      seriesId: series.id,
      seriesPublicId: series.publicId,
      createdEvents: generated.createdEvents,
      firstEventId: generated.firstCreatedEventId,
    });
  } catch (error) {
    const moderationResponse = mobileContentModerationErrorResponse(error);
    if (moderationResponse) return moderationResponse;

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    console.error("Mobile create event series error:", error);
    return NextResponse.json(
      { error: "Failed to create event series" },
      { status: 500 }
    );
  }
}
