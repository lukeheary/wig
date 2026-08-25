import { and, asc, eq, isNull } from "drizzle-orm";
import { events } from "@/server/db/schema";

/** Claim one unambiguous manual series occurrence as an Eventbrite exception. */
export async function claimManualSeriesOccurrence(params: {
  db: any;
  venueId: string;
  source: string;
  externalId: string;
  startAt: Date;
  title: string;
  description?: string | null;
  coverImageUrl?: string | null;
  eventUrl?: string | null;
  timeZone?: string | null;
  endAt?: Date | null;
  address?: string | null;
  city: string;
  state: string;
  organizerId: string;
}): Promise<string | null> {
  if (params.source !== "eventbrite") return null;

  const candidates = await params.db.query.events.findMany({
    where: and(
      eq(events.venueId, params.venueId),
      eq(events.startAt, params.startAt),
      isNull(events.source),
      isNull(events.externalId)
    ),
    columns: { id: true, seriesId: true },
    orderBy: [asc(events.createdAt)],
  });
  const seriesCandidates = candidates.filter(
    (candidate: { seriesId: string | null }) => candidate.seriesId !== null
  );
  if (seriesCandidates.length !== 1) return null;

  const [claimed] = await params.db
    .update(events)
    .set({
      source: params.source,
      externalId: params.externalId,
      title: params.title,
      description: params.description ?? null,
      coverImageUrl: params.coverImageUrl ?? null,
      sourceImageUrl: params.coverImageUrl ?? null,
      eventUrl: params.eventUrl ?? null,
      startAt: params.startAt,
      timeZone: params.timeZone ?? null,
      endAt: params.endAt ?? null,
      address: params.address ?? null,
      city: params.city,
      state: params.state,
      organizerId: params.organizerId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(events.id, seriesCandidates[0].id),
        isNull(events.source),
        isNull(events.externalId)
      )
    )
    .returning({ id: events.id });

  return claimed?.id ?? null;
}
