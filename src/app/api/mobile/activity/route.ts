import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { userActivity, userFriends } from "@/server/db/schema";
import { mapEventCategoryData } from "@/server/utils/categories";

const VISIBLE_ACTIVITY_TYPES = new Set([
  "rsvp_going",
  "rsvp_interested",
  "rsvp_not_going",
]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 100)
    : 40;

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

  const activities = activityList
    .filter((activity) => {
      if (!VISIBLE_ACTIVITY_TYPES.has(activity.type)) return false;
      if (!activity.event) return false;
      return activity.event.visibility === "public" && activity.event.status === "active";
    })
    .map((activity) => {
      const actorName =
        [activity.actor.firstName, activity.actor.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        activity.actor.username ||
        "Someone";

      const event = mapEventCategoryData(activity.event);
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
