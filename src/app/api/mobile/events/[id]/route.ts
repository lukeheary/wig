import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { events, users } from "@/server/db/schema";
import {
  canEditMobileEvent,
  resolveMobileEventEditPermissions,
} from "@/app/api/mobile/event-edit-permissions";
import { eventTimeZone } from "@/lib/utils";
import {
  filterExistingCategoryKeys,
  mapEventCategoryData,
  setEventCategoryKeys,
} from "@/server/utils/categories";
import { logEventActivity } from "@/server/utils/event-activity-logger";
import { EVENT_STATUS_VALUES, type EventStatus } from "@/lib/event-status";

const mobileUpdateEventSchema = z.object({
  venueId: z.string().uuid().optional().nullable(),
  organizerId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().optional(),
  coverImageUrl: z.string().url().optional().or(z.literal("")),
  eventUrl: z.string().url().optional(),
  startAt: z.string().min(1),
  endAt: z.string().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2),
  categories: z.array(z.string()).optional().default([]),
  status: z.enum(EVENT_STATUS_VALUES).default("active"),
  timeZone: z.string().trim().min(1).max(64).optional(),
});

function parseDateValue(value: string | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

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

    const body = mobileUpdateEventSchema.parse(await request.json());
    const startAt = parseDateValue(body.startAt);
    const endAt = parseDateValue(body.endAt);

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

    const existingEvent = await db.query.events.findFirst({
      where: eq(events.id, id),
      columns: {
        id: true,
        createdByUserId: true,
        venueId: true,
        organizerId: true,
        status: true,
        startAt: true,
      },
    });

    if (!existingEvent) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const permissions = await resolveMobileEventEditPermissions(userId);
    const isCreator = existingEvent.createdByUserId === userId;

    if (!permissions.isAdmin && !isCreator) {
      return NextResponse.json(
        { error: "You do not have permission to edit this event" },
        { status: 403 }
      );
    }

    if (!isPreview) {
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
    const cleanedDescription = body.description?.trim() || null;
    const cleanedCoverImageUrl =
      body.coverImageUrl === ""
        ? null
        : body.coverImageUrl?.trim() || null;
    const cleanedEventUrl = body.eventUrl?.trim() || null;
    const cleanedAddress = body.address?.trim() || null;
    const cleanedCity = body.city.trim();
    const cleanedState = body.state.trim().toUpperCase();
    const resolvedTimeZone =
      body.timeZone?.trim() ||
      eventTimeZone(undefined, cleanedState) ||
      null;

    const validCategories = await filterExistingCategoryKeys(db, body.categories, {
      activeOnly: true,
    });

    const [updatedEvent] = await db
      .update(events)
      .set({
        title: cleanedTitle,
        description: cleanedDescription,
        coverImageUrl: cleanedCoverImageUrl,
        eventUrl: cleanedEventUrl,
        startAt,
        endAt,
        address: cleanedAddress,
        city: cleanedCity,
        state: cleanedState,
        timeZone: resolvedTimeZone,
        status: body.status,
        venueId: body.venueId ?? null,
        organizerId: body.organizerId ?? null,
        updatedAt: new Date(),
      } as any)
      .where(eq(events.id, id))
      .returning({
        id: events.id,
        startAt: events.startAt,
        status: events.status,
      });

    if (!updatedEvent) {
      return NextResponse.json(
        { error: "Failed to update event" },
        { status: 500 }
      );
    }

    await setEventCategoryKeys(db, id, validCategories, {
      activeOnly: true,
    });

    const refreshedEvent = await db.query.events.findFirst({
      where: eq(events.id, id),
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

    if (!refreshedEvent) {
      return NextResponse.json(
        { error: "Failed to load updated event" },
        { status: 500 }
      );
    }

    const mapped = mapEventCategoryData(refreshedEvent);
    const previousStatus = existingEvent.status as EventStatus;
    const nextStatus = updatedEvent.status as EventStatus;
    const startAtChanged = existingEvent.startAt.getTime() !== updatedEvent.startAt.getTime();
    const activityType = resolveEventUpdateActivityType(
      previousStatus,
      nextStatus,
      startAtChanged
    );

    void logEventActivity({
      actorUserId: userId,
      eventId: id,
      type: activityType,
      metadata: {
        previousStatus,
        nextStatus,
        previousStartAt: existingEvent.startAt,
        nextStartAt: updatedEvent.startAt,
        changedFields: [
          "title",
          "description",
          "coverImageUrl",
          "eventUrl",
          "startAt",
          "endAt",
          "address",
          "city",
          "state",
          "timeZone",
          "status",
          "venueId",
          "organizerId",
          "categories",
        ],
      },
    });

    return NextResponse.json({
      id: mapped.id,
      title: mapped.title,
      description: mapped.description,
      coverImageUrl: mapped.coverImageUrl,
      eventUrl: mapped.eventUrl,
      seriesId: mapped.seriesId,
      startAt: mapped.startAt,
      endAt: mapped.endAt,
      address: mapped.address,
      city: mapped.city,
      state: mapped.state,
      timeZone: mapped.timeZone,
      venueId: mapped.venueId,
      venueName: mapped.venue?.name ?? null,
      venueSlug: mapped.venue?.slug ?? null,
      organizerId: mapped.organizerId,
      organizerName: mapped.organizer?.name ?? null,
      organizerSlug: mapped.organizer?.slug ?? null,
      venueLogoImageUrl: mapped.venue?.logoImageUrl ?? null,
      organizerLogoImageUrl: mapped.organizer?.logoImageUrl ?? null,
      categories: mapped.categories,
      categoryLabels: mapped.categoryLabels,
      status: mapped.status,
      updatedAt: mapped.updatedAt,
      canEdit: permissions.isAdmin || isCreator || canEditMobileEvent(permissions, {
        venueId: mapped.venueId,
        organizerId: mapped.organizerId,
      }),
      isCreatedByCurrentUser: isCreator,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid event payload" },
        { status: 400 }
      );
    }

    console.error("Failed to update mobile event", error);
    return NextResponse.json(
      { error: "Failed to update event" },
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
    const { userId } = await currentMobileUserContext();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existingEvent = await db.query.events.findFirst({
      where: eq(events.id, id),
      columns: {
        id: true,
        createdByUserId: true,
      },
    });

    if (!existingEvent) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const permissions = await resolveMobileEventEditPermissions(userId);
    const isCreator = existingEvent.createdByUserId === userId;

    if (!permissions.isAdmin && !isCreator) {
      return NextResponse.json(
        { error: "You do not have permission to delete this event" },
        { status: 403 }
      );
    }

    await db.delete(events).where(eq(events.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete mobile event", error);
    return NextResponse.json(
      { error: "Failed to delete event" },
      { status: 500 }
    );
  }
}
