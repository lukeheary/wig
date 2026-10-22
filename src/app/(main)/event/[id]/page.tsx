import { visibleEventSourceCondition } from "@/server/utils/event-source-visibility";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import EventPageClient from "./event-page-client";
import { db } from "@/server/db";
import { events } from "@/server/db/schema";
import { formatEventDate, formatEventTime } from "@/lib/utils";
import Link from "next/link";
import { withReturnTo } from "@/lib/navigation";

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
    where: and(eq(events.publicId, id), await visibleEventSourceCondition()),
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
    event.sourceImageUrl ||
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

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) {
    const { id } = await params;
    // Serve the event's metadata to unauthenticated link-preview crawlers,
    // without exposing the authenticated event API or redirecting away from it.
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Sign in to view this event</h1>
        <p className="mt-3 text-muted-foreground">Join WIG to see event details and who’s going.</p>
        <Link
          href={withReturnTo("/sign-in", `/event/${id}`)}
          className="mt-6 inline-flex rounded-full bg-neon-teal px-6 py-3 font-semibold text-black"
        >
          Sign in
        </Link>
      </main>
    );
  }
  return <EventPageClient />;
}
