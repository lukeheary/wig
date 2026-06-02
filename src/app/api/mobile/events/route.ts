import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/server/db";
import { events } from "@/server/db/schema";
import { mapEventCategoryData } from "@/server/utils/categories";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 50)
    : 20;

  const now = new Date();

  const eventList = await db.query.events.findMany({
    where: and(
      eq(events.visibility, "public"),
      eq(events.status, "active"),
      gte(events.startAt, now)
    ),
    orderBy: [events.startAt],
    limit,
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

  const payload = eventList.map((event) => {
    const mapped = mapEventCategoryData(event);

    return {
      id: mapped.id,
      title: mapped.title,
      description: mapped.description,
      coverImageUrl: mapped.coverImageUrl,
      eventUrl: mapped.eventUrl,
      startAt: mapped.startAt,
      endAt: mapped.endAt,
      address: mapped.address,
      city: mapped.city,
      state: mapped.state,
      venueName: mapped.venue?.name ?? null,
      organizerName: mapped.organizer?.name ?? null,
      venueLogoImageUrl: mapped.venue?.logoImageUrl ?? null,
      organizerLogoImageUrl: mapped.organizer?.logoImageUrl ?? null,
      categories: mapped.categories,
      categoryLabels: mapped.categoryLabels,
      updatedAt: mapped.updatedAt,
    };
  });

  return NextResponse.json(payload);
}
