"use client";

import Image from "next/image";
import Link from "next/link";
import { format } from "date-fns";
import { Calendar } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { Card } from "@/components/ui/card";
import { type EventCardItem } from "@/components/calendar/event-card";
import { EventCardGrid } from "@/components/events/event-card-grid";
import { getEventStatusLabel } from "@/lib/event-status";
import {
  buildReturnTo,
  getScrollRestoreKey,
  withReturnTo,
} from "@/lib/navigation";
import { cn, formatTime, splitTrailingParenthetical } from "@/lib/utils";

type SocialUser = {
  id: string;
  avatarImageUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  rsvpStatus: "going" | "interested";
};

export const HOME_MOBILE_EVENT_CARD_WIDTH = 212;

function getSocialUsers(event: EventCardItem): SocialUser[] {
  const friendsGoing = event.friendsGoing || [];
  const friendsInterested = event.friendsInterested || [];

  return [...friendsGoing, ...friendsInterested].flatMap((rsvp) => {
    if (rsvp.status !== "going" && rsvp.status !== "interested") {
      return [];
    }

    return [
      {
        ...rsvp.user,
        rsvpStatus: rsvp.status,
      },
    ];
  });
}

function HomeMiniEventCard({ event }: { event: EventCardItem }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = buildReturnTo(pathname, searchParams);
  const eventHref = withReturnTo(`/event/${event.id}`, returnTo);
  const eventDate = new Date(event.startAt);
  const month = format(eventDate, "MMM");
  const day = format(eventDate, "d");
  const startTime = formatTime(event.startAt);
  const { main: titleMain, trailingParenthetical } = splitTrailingParenthetical(
    event.title
  );
  const socialUsers = getSocialUsers(event);
  const hasInactiveStatus = event.status !== "active";
  const eventImageUrl =
    event.coverImageUrl ||
    event.venue?.logoImageUrl ||
    event.organizer?.logoImageUrl ||
    null;
  const subtitle = event.venue?.name || event.organizer?.name || "TBA";

  const handleClick = () => {
    if (typeof window === "undefined") return;

    const currentPath = `${window.location.pathname}${window.location.search}`;
    window.sessionStorage.setItem(
      getScrollRestoreKey(currentPath),
      String(window.scrollY)
    );
  };

  return (
    <Link href={eventHref} className="group block h-full" onClick={handleClick}>
      <Card className="relative flex h-full cursor-pointer flex-col overflow-hidden !border-none bg-card p-2 transition-all duration-300">
        <div className="relative aspect-[0.98] overflow-hidden rounded-2xl bg-muted">
          {eventImageUrl ? (
            <Image
              src={eventImageUrl}
              alt={event.title}
              fill
              className={cn(
                "object-cover transition-transform duration-500 group-hover:scale-[1.03]",
                hasInactiveStatus && "opacity-50 blur-[2px]"
              )}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/30 to-primary/10">
              <Calendar className="h-12 w-12 text-muted-foreground/20" />
            </div>
          )}

          {hasInactiveStatus && (
            <div className="absolute inset-x-2 bottom-2">
              <span className="inline-flex rounded-full bg-card/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur">
                {getEventStatusLabel(event.status)}
              </span>
            </div>
          )}

          {socialUsers.length > 0 && (
            <div className="absolute bottom-2 right-2">
              <AvatarStack users={socialUsers} maxDisplay={3} size="md" />
            </div>
          )}
        </div>

        <div className="font-space-grotesk flex flex-1 flex-col px-1 pb-1 pt-3">
          <h3 className="line-clamp-2 text-sm/5 font-medium transition-colors group-hover:text-primary">
            {titleMain}
            {trailingParenthetical ? (
              <span className="whitespace-nowrap">
                {" "}
                {trailingParenthetical}
              </span>
            ) : null}
          </h3>

          <div
            className={cn(
              "pt-1 text-[13px] font-medium leading-tight text-neon-teal",
              hasInactiveStatus && "line-through"
            )}
          >
            {month} {day} at {startTime}
          </div>

          <div className="pt-1 text-xs text-primary/70">
            <span className="line-clamp-1">{subtitle}</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function HomeMobileEventRail({ events }: { events: EventCardItem[] }) {
  return (
    <>
      <div className="-mx-4 overflow-x-auto [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max items-stretch gap-3 px-4 pb-1">
          {events.map((event) => (
            <div
              key={event.id}
              className="shrink-0 self-stretch"
              style={{ width: `${HOME_MOBILE_EVENT_CARD_WIDTH}px` }}
            >
              <HomeMiniEventCard event={event} />
            </div>
          ))}
        </div>
      </div>

      <div className="hidden md:block">
        <EventCardGrid
          events={events}
          columns={{ mobile: 1, tablet: 3, desktop: 4 }}
          gap="md"
        />
      </div>
    </>
  );
}
