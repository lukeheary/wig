import { auth } from "@clerk/nextjs/server";
import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/server/db";
import { eventSeries, places } from "@/server/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    await auth();
    const { slug } = await params;

    const place = await db.query.places.findFirst({
      where: eq(places.slug, slug),
      columns: { id: true, type: true },
    });

    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    const condition =
      place.type === "venue"
        ? eq(eventSeries.venueId, place.id)
        : eq(eventSeries.organizerId, place.id);

    const series = await db.query.eventSeries.findMany({
      where: and(condition, eq(eventSeries.isActive, true)),
      columns: {
        id: true,
        title: true,
        frequency: true,
        interval: true,
        daysOfWeek: true,
        startAt: true,
        untilDate: true,
        status: true,
      },
      orderBy: (es, { asc }) => [asc(es.startAt)],
    });

    return NextResponse.json({ series });
  } catch (error) {
    console.error("GET /api/mobile/places/[slug]/event-series failed", error);
    return NextResponse.json(
      { error: "Failed to load event series." },
      { status: 500 }
    );
  }
}
