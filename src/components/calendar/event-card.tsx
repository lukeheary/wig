"use client";

import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import {
  cn,
  formatEventDate,
  formatEventTime,
  splitTrailingParenthetical,
} from "@/lib/utils";
import { Calendar } from "lucide-react";
import { format } from "date-fns";
import { EventSocialOverlay } from "@/components/events/event-social-overlay";
import {
  getEventImageUrl,
  getSocialUsers,
  type EventCardItem,
} from "@/components/events/event-card-helpers";
import { useEventCardLink } from "@/components/events/use-event-card-link";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { getEventStatusLabel } from "@/lib/event-status";

interface EventCardProps {
  event: EventCardItem;
}

export function EventCard({ event }: EventCardProps) {
  const { eventHref, handleClick } = useEventCardLink(event.id);
  const dayOfWeek = formatEventDate(event.startAt, event.timeZone, event.state, {
    weekday: "short",
  });
  const month = formatEventDate(event.startAt, event.timeZone, event.state, {
    month: "short",
  });
  const day = formatEventDate(event.startAt, event.timeZone, event.state, {
    day: "numeric",
  });
  const startTime = formatEventTime(event.startAt, event.timeZone, event.state);
  const { main: titleMain, trailingParenthetical } = splitTrailingParenthetical(
    event.title
  );

  const socialUsers = getSocialUsers(event);
  const hasInactiveStatus = event.status !== "active";
  const eventImageUrl = getEventImageUrl(event);

  return (
    <Link href={eventHref} className="group block h-full" onClick={handleClick}>
      <Card className="relative h-full cursor-pointer overflow-hidden !border-none bg-card p-2 transition-all duration-300 md:flex-col">
        {/* Container - horizontal on mobile, vertical on desktop */}
        <div className="flex md:block">
          {/* Square Image - smaller on mobile, full width on desktop */}
          <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-2xl bg-muted md:aspect-square md:h-auto md:w-full lg:max-w-[274px]">
            {eventImageUrl ? (
              <Image
                src={eventImageUrl}
                alt={event.title}
                fill
                className={cn(
                  "object-cover transition-transform duration-500",
                  hasInactiveStatus && "opacity-50 blur-[2px]"
                )}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/30 to-primary/10">
                <Calendar className="h-12 w-12 text-muted-foreground/20 md:h-24 md:w-24" />
              </div>
            )}
            <EventSocialOverlay
              users={socialUsers}
              size="lg"
              stackClassName="hidden drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)] md:block"
            />
            {hasInactiveStatus && (
              <div className="absolute inset-0 flex items-center justify-center px-2">
                <span className="relative z-10 rounded-md bg-card px-1 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-white md:px-2 md:text-base">
                  {getEventStatusLabel(event.status)}
                </span>
              </div>
            )}
          </div>

          {/* Event Information - to the right on mobile, below on desktop */}
          <div className="font-space-grotesk flex-1 space-y-1.5 py-1 pl-3 pr-1 md:px-3 md:py-3">
            {/* Title */}
            <h3 className="line-clamp-2 text-base/5 font-medium transition-colors group-hover:text-primary">
              {titleMain}
              {trailingParenthetical ? (
                <span className="whitespace-nowrap">
                  {" "}
                  {trailingParenthetical}
                </span>
              ) : null}
            </h3>

            {/* Date */}
            <div
              className={cn(
                "text-sm font-medium leading-tight text-neon-teal",
                hasInactiveStatus && "line-through"
              )}
            >
              {dayOfWeek}, {month} {day} at {startTime}
            </div>

            {/* Venue & Organizer */}
            <div className="line-clamp-1 text-sm leading-tight text-primary/70">
              {event.venue && `${event.venue.name}`}
              {/*{event.organizer &&*/}
              {/*  (event.venue*/}
              {/*    ? ` • ${event.organizer.name}`*/}
              {/*    : event.organizer.name)}*/}
            </div>
          </div>
        </div>

        {/* Friends Going - pinned to bottom right of the full card */}
        {socialUsers.length > 0 && (
          <div className="absolute bottom-2 right-2">
            <div className="md:hidden">
              <AvatarStack users={socialUsers} maxDisplay={3} size="sm" />
            </div>
          </div>
        )}
      </Card>
    </Link>
  );
}
