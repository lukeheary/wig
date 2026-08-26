"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Star } from "lucide-react";
import { EventSocialOverlay } from "@/components/events/event-social-overlay";
import { useEventCardLink } from "@/components/events/use-event-card-link";
import { formatEventDate, formatEventTime } from "@/lib/utils";

export type WhatsNewFilter = "following" | "allPlaces";

export type WhatsNewEvent = {
  id: string;
  publicId: string;
  title: string;
  coverImageUrl: string | null;
  startAt: string;
  city: string;
  state: string;
  timeZone: string | null;
  venueName: string | null;
  venueLogoImageUrl: string | null;
  organizerName: string | null;
  organizerLogoImageUrl: string | null;
  friendsGoing: Array<{
    status: "going" | "interested" | "not_going";
    user: {
      id: string;
      avatarImageUrl: string | null;
      firstName: string | null;
      lastName: string | null;
    };
  }>;
  friendsInterested: Array<{ status: string }>;
};

export type WhatsNewUpdate = {
  event: WhatsNewEvent;
  kind: "newEvent" | "seriesUpdated";
  activityDate: number;
};

const FILTER_LABELS: Record<WhatsNewFilter, string> = {
  following: "Following",
  allPlaces: "All Places",
};

export function WhatsNewSection({
  updates,
  hasFollowedPlaces,
  selection,
  onSelectionChange,
}: {
  updates: WhatsNewUpdate[];
  hasFollowedPlaces: boolean;
  selection: WhatsNewFilter;
  onSelectionChange: (selection: WhatsNewFilter) => void;
}) {
  return (
    <section aria-label="What’s New" className="mt-5 md:mt-4">
      <div className="container mx-auto flex items-center justify-between px-4 pb-2">
        <h2 className="text-[19px] font-bold tracking-tight text-white md:text-2xl">
          What’s New
        </h2>
        <label className="relative flex cursor-pointer items-center gap-1.5 text-sm font-medium text-white/70 transition-colors hover:text-white">
          <span>{FILTER_LABELS[selection]}</span>
          <ChevronDown className="h-3.5 w-3.5" />
          <select
            aria-label="What’s New places filter"
            value={selection}
            onChange={(event) =>
              onSelectionChange(event.target.value as WhatsNewFilter)
            }
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          >
            {(Object.keys(FILTER_LABELS) as WhatsNewFilter[]).map((filter) => (
              <option key={filter} value={filter}>
                {FILTER_LABELS[filter]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {updates.length > 0 ? (
        <div className="container mx-auto px-4">
          <div className="-mx-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max items-start gap-3 px-4 pb-1 md:gap-4">
              {updates.map((update) => (
                <WhatsNewCard key={update.event.id} update={update} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="container mx-auto px-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-white/50">
            {hasFollowedPlaces
              ? "No recent updates from places you follow."
              : "Follow places to see their latest updates here."}
          </div>
        </div>
      )}
    </section>
  );
}

function WhatsNewCard({ update }: { update: WhatsNewUpdate }) {
  const { event } = update;
  const { eventHref, handleClick } = useEventCardLink(event.publicId);
  const imageUrl =
    event.coverImageUrl ||
    event.venueLogoImageUrl ||
    event.organizerLogoImageUrl;
  const socialUsers = event.friendsGoing
    .filter((rsvp) => rsvp.status === "going")
    .map((rsvp) => ({ ...rsvp.user, rsvpStatus: "going" as const }));
  const interestedCount = event.friendsInterested.filter(
    (rsvp) => rsvp.status === "interested"
  ).length;
  const location =
    event.venueName || event.organizerName || `${event.city}, ${event.state}`;
  const date = formatEventDate(event.startAt, event.timeZone, event.state, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = formatEventTime(event.startAt, event.timeZone, event.state);

  return (
    <Link
      href={eventHref}
      onClick={handleClick}
      className="block w-[164px] shrink-0 text-left md:w-[200px]"
      aria-label={`${update.kind === "seriesUpdated" ? "Series updated" : "New event"}, ${event.title}, ${date} at ${time}, ${location}`}
    >
      <div className="relative h-[164px] w-[164px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#111116] md:h-[200px] md:w-[200px]">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            fill
            sizes="(max-width: 767px) 164px, 200px"
            className="object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-white/10 to-white/[0.03]" />
        )}
        <EventSocialOverlay
          users={socialUsers}
          size="md"
          placement="top-right"
        />
      </div>

      <div className="space-y-[3px] pt-2">
        <h3 className="truncate text-[13px] font-semibold text-white">
          {event.title}
        </h3>
        <p className="truncate text-xs font-medium text-sky-300">
          {date} at {time}
        </p>
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-white/60">
            {location}
          </p>
          {interestedCount > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-yellow-400">
              <Star className="h-3 w-3 fill-current" aria-hidden="true" />
              {interestedCount}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
