import { auth } from "@clerk/nextjs/server";
import { asc, and, eq, gte, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { EVENT_STATUS_VALUES } from "@/lib/event-status";
import { eventTimeZone } from "@/lib/utils";
import { db } from "@/server/db";
import { eventSeries, events, users } from "@/server/db/schema";
import {
  filterExistingCategoryKeys,
  mapEventSeriesCategoryData,
  setEventSeriesCategoryKeys,
} from "@/server/utils/categories";
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
import { withStoredImageReplacements } from "@/server/utils/stored-image-lifecycle";
import { isPublicId, publicOrUuidSchema } from "@/lib/public-id";
import {
  enforceMobileContentCreation,
  mobileContentModerationErrorResponse,
} from "@/app/api/mobile/content-moderation";

const mobileUpdateEventSeriesSchema = z.object({
  venueId: z.string().uuid().nullable().optional(),
  organizerId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().optional(),
  coverImageUrl: z.string().url().nullable().optional(),
  removeCoverImage: z.boolean().optional().default(false),
  eventUrl: z.string().url().nullable().optional(),
  startAt: z.string().min(1),
  endAt: z.string().nullable().optional(),
  address: z.string().trim().nullable().optional(),
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

function parseDateValue(value: string | null | undefined) {
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

async function canManageSeries(
  userId: string,
  isPreview: boolean,
  series: typeof eventSeries.$inferSelect
) {
  if (isPreview) {
    return true;
  }

  const permissions = await resolveMobileEventEditPermissions(userId);
  if (permissions.isAdmin || series.createdByUserId === userId) {
    return true;
  }

  return [series.venueId, series.organizerId].some(
    (placeId) => placeId && permissions.manageablePlaceIds.has(placeId)
  );
}

function mapMobileEventSeries(series: any) {
  const mapped = mapEventSeriesCategoryData(series);
  const durationMinutes =
    typeof mapped.durationMinutes === "number" && mapped.durationMinutes > 0
      ? mapped.durationMinutes
      : null;

  return {
    id: mapped.id,
    publicId: mapped.publicId,
    title: mapped.title,
    description: mapped.description,
    coverImageUrl: mapped.coverImageUrl,
    eventUrl: mapped.eventUrl,
    startAt: mapped.startAt,
    endAt: durationMinutes
      ? new Date(mapped.startAt.getTime() + durationMinutes * 60 * 1000)
      : null,
    address: mapped.address,
    city: mapped.city,
    state: mapped.state,
    timeZone: mapped.timeZone,
    venueId: mapped.venueId,
    venueName: mapped.venue?.name ?? null,
    venueSlug: mapped.venue?.slug ?? null,
    venueLogoImageUrl: mapped.venue?.logoImageUrl ?? null,
    organizerId: mapped.organizerId,
    organizerName: mapped.organizer?.name ?? null,
    organizerSlug: mapped.organizer?.slug ?? null,
    organizerLogoImageUrl: mapped.organizer?.logoImageUrl ?? null,
    categories: mapped.categories,
    categoryLabels: mapped.categoryLabels,
    status: mapped.status,
    frequency: mapped.frequency,
    interval: mapped.interval,
    daysOfWeek: mapped.daysOfWeek ?? [],
    untilDate: mapped.untilDate,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const seriesIdentifier = publicOrUuidSchema.parse(id);
    const { userId, isPreview } = await currentMobileUserContext();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const series = await db.query.eventSeries.findFirst({
      where: isPublicId(seriesIdentifier)
        ? eq(eventSeries.publicId, seriesIdentifier)
        : eq(eventSeries.id, seriesIdentifier),
      with: {
        venue: true,
        organizer: true,
        categoryLinks: {
          with: {
            category: true,
          },
        },
      },
    });

    if (!series) {
      return NextResponse.json(
        { error: "Event series not found" },
        { status: 404 }
      );
    }

    if (!(await canManageSeries(userId, isPreview, series))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(mapMobileEventSeries(series));
  } catch (error) {
    console.error("Mobile event series detail error:", error);
    return NextResponse.json(
      { error: "Failed to load event series" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { userId, isPreview } = await currentMobileUserContext();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existingSeries = await db.query.eventSeries.findFirst({
      where: eq(eventSeries.id, id),
    });

    if (!existingSeries) {
      return NextResponse.json(
        { error: "Event series not found" },
        { status: 404 }
      );
    }

    if (!(await canManageSeries(userId, isPreview, existingSeries))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = mobileUpdateEventSeriesSchema.parse(await request.json());
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
    const cleanedAddress = body.address?.trim() || null;
    const cleanedEventUrl = body.eventUrl?.trim() || null;
    const submittedCoverImageUrl = body.removeCoverImage
      ? null
      : body.coverImageUrl?.trim() || existingSeries.coverImageUrl;
    const pendingCoverImageUrl =
      submittedCoverImageUrl && isPendingStorageUrl(submittedCoverImageUrl)
        ? submittedCoverImageUrl
        : null;
    const cleanedCoverImageUrl = pendingCoverImageUrl
      ? await uploadImageFromUrl(
          pendingCoverImageUrl,
          `event-series/${id}/cover-images`,
          "cover-image.jpg"
        )
      : submittedCoverImageUrl;
    const resolvedTimeZone =
      body.timeZone?.trim() ||
      eventTimeZone(undefined, cleanedState) ||
      existingSeries.timeZone;
    const durationMinutes = endAt
      ? Math.floor((endAt.getTime() - startAt.getTime()) / 60000)
      : null;
    const normalizedDaysOfWeek = normalizeSeriesDaysOfWeek(
      body.recurrence.frequency,
      body.recurrence.daysOfWeek,
      startAt,
      resolvedTimeZone
    );
    const validCategories = await filterExistingCategoryKeys(
      db,
      body.categories,
      { activeOnly: true }
    );

    await db
      .update(eventSeries)
      .set({
        title: cleanedTitle,
        description: cleanedDescription,
        coverImageUrl: cleanedCoverImageUrl,
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
        updatedAt: new Date(),
      })
      .where(eq(eventSeries.id, id));

    await setEventSeriesCategoryKeys(db, id, validCategories, {
      activeOnly: true,
    });

    const now = new Date();
    await db
      .delete(events)
      .where(
        and(
          eq(events.seriesId, id),
          gte(events.startAt, now),
          isNull(events.externalId)
        )
      );

    const generated = await materializeEventSeries(db, {
      seriesIds: [id],
      now,
      ...(untilDate ? { windowEnd: untilDate } : {}),
    });

    if (pendingCoverImageUrl) {
      await deleteFromS3(pendingCoverImageUrl).catch(() => undefined);
    }

    await withStoredImageReplacements({
      db,
      replacements: [
        {
          oldUrl: existingSeries.coverImageUrl,
          newUrl: cleanedCoverImageUrl,
        },
      ],
      persist: async () => undefined,
    });

    const nextEvent = await db.query.events.findFirst({
      where: and(eq(events.seriesId, id), gte(events.startAt, now)),
      orderBy: [asc(events.startAt)],
      columns: { id: true },
    });

    return NextResponse.json({
      seriesId: id,
      createdEvents: generated.createdEvents,
      firstEventId: nextEvent?.id ?? generated.firstCreatedEventId,
    });
  } catch (error) {
    const moderationResponse = mobileContentModerationErrorResponse(error);
    if (moderationResponse) return moderationResponse;

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid event series payload" },
        { status: 400 }
      );
    }

    console.error("Mobile update event series error:", error);
    return NextResponse.json(
      { error: "Failed to update event series" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { userId, isPreview } = await currentMobileUserContext();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existingSeries = await db.query.eventSeries.findFirst({
      where: eq(eventSeries.id, id),
    });

    if (!existingSeries) {
      return NextResponse.json(
        { error: "Event series not found" },
        { status: 404 }
      );
    }

    if (!(await canManageSeries(userId, isPreview, existingSeries))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date();
    await db
      .delete(events)
      .where(and(eq(events.seriesId, id), gte(events.startAt, now)));

    await db.delete(eventSeries).where(eq(eventSeries.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mobile delete event series error:", error);
    return NextResponse.json(
      { error: "Failed to delete event series" },
      { status: 500 }
    );
  }
}
