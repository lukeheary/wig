import { auth } from "@clerk/nextjs/server";
import { addDays, subDays, startOfDay } from "date-fns";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import {
  userActivity,
  userFriends,
  userSurfaceState,
  users,
} from "@/server/db/schema";
import { mapEventCategoryData } from "@/server/utils/categories";

const HOME_RECENT_ACTIVITY_SURFACE = "home_recent_activity";
const HOME_ACTIVITY_WINDOW_DAYS = 1;
const VISIBLE_ACTIVITY_TYPES = new Set([
  "rsvp_going",
  "rsvp_interested",
  "rsvp_not_going",
]);

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

function activityTimestamp(activity: {
  updatedAt: Date | null;
  createdAt: Date;
}) {
  return activity.updatedAt ?? activity.createdAt;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "3");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 10)
    : 3;
  const previewWindow = Math.min(50, Math.max(limit * 4, limit + 6));
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({
      friendCount: 0,
      requestCount: 0,
      activities: [],
    });
  }

  const now = new Date();
  const recentCutoff = subDays(now, HOME_ACTIVITY_WINDOW_DAYS).getTime();
  const today = startOfDay(now);

  const [friendCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userFriends)
    .where(eq(userFriends.status, "accepted"));

  const [requestCountRow, surfaceState, activityList] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userFriends)
      .where(eq(userFriends.status, "pending"))
      .then(([row]) => row),
    db.query.userSurfaceState.findFirst({
      where: and(
        eq(userSurfaceState.userId, userId),
        eq(userSurfaceState.surface, HOME_RECENT_ACTIVITY_SURFACE)
      ),
    }),
    db.query.userActivity.findMany({
      where: and(
        eq(userActivity.entityType, "event"),
        sql`${userActivity.type} in ('rsvp_going', 'rsvp_interested', 'rsvp_not_going')`
      ),
      orderBy: [desc(userActivity.updatedAt), desc(userActivity.createdAt)],
      limit: previewWindow,
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
    }),
  ]);

  const visibleActivities = activityList
    .filter((activity) => {
      if (!VISIBLE_ACTIVITY_TYPES.has(activity.type)) return false;
      if (!activity.event) return false;
      if (activity.event.visibility !== "public" || activity.event.status !== "active") {
        return false;
      }

      return startOfDay(activity.event.startAt) >= today;
    })
    .sort((a, b) => activityTimestamp(b).getTime() - activityTimestamp(a).getTime());

  const activeMissedWindowExpiresAt =
    surfaceState?.missedWindowExpiresAt?.getTime() ?? null;
  const hasActiveMissedWindow =
    surfaceState?.missedWindowStartAt != null &&
    activeMissedWindowExpiresAt != null &&
    activeMissedWindowExpiresAt > now.getTime();
  const activeMissedWindowStartAt = hasActiveMissedWindow
    ? surfaceState?.missedWindowStartAt?.getTime() ?? null
    : null;

  const recentActivities = visibleActivities.filter(
    (activity) => activityTimestamp(activity).getTime() >= recentCutoff
  );
  const missedActivities = hasActiveMissedWindow
    ? visibleActivities.filter((activity) => {
        const timestamp = activityTimestamp(activity).getTime();
        return (
          activeMissedWindowStartAt != null &&
          timestamp > activeMissedWindowStartAt &&
          timestamp < recentCutoff
        );
      })
    : surfaceState?.lastVisitedAt == null
      ? []
      : visibleActivities.filter((activity) => {
          const timestamp = activityTimestamp(activity).getTime();
          return (
            surfaceState.lastVisitedAt != null &&
            timestamp > surfaceState.lastVisitedAt.getTime() &&
            timestamp < recentCutoff
          );
        });

  const shouldStartMissedWindow =
    !hasActiveMissedWindow && missedActivities.length > 0;
  const previewActivities = [...recentActivities, ...missedActivities]
    .filter(
      (activity, index, collection) =>
        collection.findIndex((candidate) => candidate.id === activity.id) === index
    )
    .slice(0, limit);

  const nextMissedWindowStartAt = hasActiveMissedWindow
    ? surfaceState?.missedWindowStartAt ?? null
    : shouldStartMissedWindow
      ? surfaceState?.lastVisitedAt ?? null
      : null;
  const nextMissedWindowExpiresAt = hasActiveMissedWindow
    ? surfaceState?.missedWindowExpiresAt ?? null
    : shouldStartMissedWindow
      ? addDays(now, HOME_ACTIVITY_WINDOW_DAYS)
      : null;

  await db
    .insert(userSurfaceState)
    .values({
      userId,
      surface: HOME_RECENT_ACTIVITY_SURFACE,
      lastVisitedAt: now,
      missedWindowStartAt: nextMissedWindowStartAt,
      missedWindowExpiresAt: nextMissedWindowExpiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userSurfaceState.userId, userSurfaceState.surface],
      set: {
        lastVisitedAt: now,
        missedWindowStartAt: nextMissedWindowStartAt,
        missedWindowExpiresAt: nextMissedWindowExpiresAt,
        updatedAt: now,
      },
    });

  const activities = previewActivities.map((activity) => {
    const actorName =
      [activity.actor.firstName, activity.actor.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      activity.actor.username ||
      "Someone";
    const event = mapEventCategoryData(activity.event!);
    const venue = event.venue;

    return {
      id: activity.id,
      type: activity.type,
      actorName,
      actorAvatarImageUrl: activity.actor.avatarImageUrl,
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
