import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import EventPageClient from "./event-page-client";
import { db } from "@/server/db";
import { events } from "@/server/db/schema";
import { formatEventDate, formatEventTime } from "@/lib/utils";

function getEventMetaDescription(event: {
  description: string | null;
  startAt: Date;
  venue?: { name: string | null } | null;
  city: string;
  state: string;
  timeZone: string | null;
}) {
  const explicitDescription = event.description
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  if (explicitDescription) {
    return explicitDescription;
  }

  const venueName = event.venue?.name ? ` at ${event.venue.name}` : "";
  const eventDate = formatEventDate(event.startAt, event.timeZone, event.state, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const eventTime = formatEventTime(event.startAt, event.timeZone, event.state);
  return `${eventDate} at ${eventTime}${venueName} in ${event.city}, ${event.state}.`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { userId } = await auth();

  const event = await db.query.events.findFirst({
    where: eq(events.publicId, id),
    with: {
      venue: true,
      organizer: true,
    },
  });

  if (!event || (event.visibility !== "public" && !userId)) {
    return {
      title: "WIG",
      description: "Discover local events and connect with your community",
    };
  }

  const imageUrl =
    event.coverImageUrl ||
    event.venue?.logoImageUrl ||
    event.organizer?.logoImageUrl ||
    undefined;
  const description = getEventMetaDescription(event);

  return {
    title: `${event.title} | WIG`,
    description,
    alternates: {
      canonical: `/event/${event.publicId}`,
    },
    openGraph: {
      title: event.title,
      description,
      url: `/event/${event.publicId}`,
      siteName: "WIG",
      type: "website",
      images: imageUrl
        ? [
            {
              url: imageUrl,
              alt: event.title,
            },
          ]
        : undefined,
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title: event.title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export default function EventPage() {
  return <EventPageClient />;
}
