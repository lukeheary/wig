import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  eventRsvps,
  userActivity,
  userFriends,
  users,
} from "@/server/db/schema";
import { mapEventCategoryData } from "@/server/utils/categories";
import {
  canEditMobileEvent,
  resolveMobileEventEditPermissions,
} from "@/app/api/mobile/event-edit-permissions";

const VISIBLE_ACTIVITY_TYPES = new Set([
  "rsvp_going",
  "rsvp_interested",
  "rsvp_not_going",
]);

function getNotGoingReason(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const reason = (metadata as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

async function currentMobileUserId() {
  const { userId } = await auth();

  if (userId) {
    return userId;
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: {
      id: true,
    },
  });

  return previewUser?.id ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 100)
    : 40;
  const userId = await currentMobileUserId();

  const [friendCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userFriends)
    .where(eq(userFriends.status, "accepted"));

  const [requestCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userFriends)
    .where(eq(userFriends.status, "pending"));

  const activityList = await db.query.userActivity.findMany({
    where: and(
      eq(userActivity.entityType, "event"),
      sql`${userActivity.type} in ('rsvp_going', 'rsvp_interested', 'rsvp_not_going')`
    ),
    orderBy: [desc(userActivity.updatedAt), desc(userActivity.createdAt)],
    limit,
    with: {
      actor: true,
      event: {
        with: {
          venue: true,
          organizer: true,
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      },
    },
  });

  const visibleActivities = activityList.filter((activity) => {
    if (!VISIBLE_ACTIVITY_TYPES.has(activity.type)) return false;
    if (!activity.event) return false;
    return activity.event.visibility === "public" && activity.event.status === "active";
  });

  const eventIds = visibleActivities
    .map((activity) => activity.event?.id)
    .filter((id): id is string => Boolean(id));
  const currentUserRsvpMap =
    userId && eventIds.length > 0
      ? new Map(
          (
            await db.query.eventRsvps.findMany({
              where: and(
                inArray(eventRsvps.eventId, eventIds),
                eq(eventRsvps.userId, userId)
              ),
              columns: {
                eventId: true,
                status: true,
                notGoingReason: true,
              },
            })
          ).map((rsvp) => [
            rsvp.eventId,
            {
              status: rsvp.status,
              notGoingReason: rsvp.notGoingReason,
            },
          ])
        )
      : new Map<string, { status: string; notGoingReason: string | null }>();
  const editPermissions = await resolveMobileEventEditPermissions(userId);

  const activities = visibleActivities.map((activity) => {
      const actorName =
        [activity.actor.firstName, activity.actor.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        activity.actor.username ||
        "Someone";

      const event = mapEventCategoryData(activity.event);
      const venue = event.venue;
      const currentUserRsvp = currentUserRsvpMap.get(event.id) ?? null;

      return {
        id: activity.id,
        type: activity.type,
        actorName,
        actorGender: activity.actor.gender,
        actorAvatarImageUrl: activity.actor.avatarImageUrl,
        notGoingReason:
          activity.type === "rsvp_not_going"
            ? getNotGoingReason(activity.metadata)
            : null,
        createdAt: activity.createdAt,
        updatedAt: activity.updatedAt,
        event: {
          id: event.id,
          title: event.title,
          description: event.description,
          coverImageUrl: event.coverImageUrl,
          eventUrl: event.eventUrl,
          startAt: event.startAt,
          endAt: event.endAt,
          address: event.address,
          city: event.city,
          state: event.state,
          timeZone: event.timeZone,
          venueId: event.venueId,
          venueName: venue?.name ?? null,
          venueSlug: venue?.slug ?? null,
          organizerId: event.organizerId,
          organizerName: event.organizer?.name ?? null,
          organizerSlug: event.organizer?.slug ?? null,
          venueLogoImageUrl: venue?.logoImageUrl ?? null,
          organizerLogoImageUrl: event.organizer?.logoImageUrl ?? null,
          categories: event.categories,
          categoryLabels: event.categoryLabels,
          updatedAt: event.updatedAt,
          canEdit: canEditMobileEvent(editPermissions, {
            venueId: event.venueId,
            organizerId: event.organizerId,
          }),
          userRsvpStatus: currentUserRsvp?.status ?? null,
          userRsvpNotGoingReason: currentUserRsvp?.notGoingReason ?? null,
          venue: venue
            ? {
                id: venue.id,
                type: venue.type,
                slug: venue.slug,
                name: venue.name,
                logoImageUrl: venue.logoImageUrl,
                city: venue.city,
                state: venue.state,
                upcomingEventCount: 0,
                updatedAt: venue.updatedAt,
              }
            : null,
        },
      };
    });

  return NextResponse.json({
    friendCount: friendCountRow?.count ?? 0,
    requestCount: requestCountRow?.count ?? 0,
    activities,
  });
}
