"use client";

import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { cn, formatTime } from "@/lib/utils";
import { Calendar } from "lucide-react";
import { format } from "date-fns";
import { type EventListItem } from "@/types/trpc";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { getEventStatusLabel } from "@/lib/event-status";

interface EventCardProps {
  event: EventListItem;
}

export function EventCard({ event }: EventCardProps) {
  const eventDate = new Date(event.startAt);
  const dayOfWeek = format(eventDate, "EEE");
  const month = format(eventDate, "MMM");
  const day = format(eventDate, "d");
  const startTime = formatTime(event.startAt);

  const friendsGoing = event.friendsGoing || [];
  const goingUsers = friendsGoing.map((rsvp) => rsvp.user);
  const hasInactiveStatus = event.status !== "active";

  return (
    <Link href={`/event/${event.id}`} className="group">
      <Card className="relative h-full cursor-pointer overflow-hidden !border-none bg-card p-2 transition-all duration-300 md:flex-col">
        {/* Container - horizontal on mobile, vertical on desktop */}
        <div className="flex md:block">
          {/* Square Image - smaller on mobile, full width on desktop */}
          <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-2xl bg-muted md:aspect-square md:h-auto md:w-full lg:max-w-[274px]">
            {event.coverImageUrl ? (
              <Image
                src={event.coverImageUrl}
                alt={event.title}
                fill
                className={cn(
                  "object-cover transition-transform duration-500",
                  hasInactiveStatus && "opacity-75 blur-[1px]"
                )}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/30 to-primary/10">
                <Calendar className="h-12 w-12 text-muted-foreground/20 md:h-24 md:w-24" />
              </div>
            )}
            {hasInactiveStatus && (
              <div className="absolute inset-0 flex items-center justify-center px-2">
                <span className="relative z-10 rounded-md bg-card px-1 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-white md:text-sm">
                  {getEventStatusLabel(event.status)}
                </span>
              </div>
            )}
          </div>

          {/* Event Information - to the right on mobile, below on desktop */}
          <div className="flex-1 space-y-1 py-1 pl-3 pr-1 md:px-3 md:py-3">
            {/* Title */}
            <h3 className="line-clamp-2 text-base font-bold leading-tight transition-colors group-hover:text-primary md:text-base">
              {event.title}
            </h3>

            {/* Date */}
            <div className="text-sm text-primary/70 md:text-sm">
              {dayOfWeek}, {month} {day} at {startTime}
            </div>

            {/* Venue & Organizer */}
            <div className="line-clamp-1 text-sm text-primary/70 md:text-sm">
              {event.venue && `${event.venue.name}`}
              {/*{event.organizer &&*/}
              {/*  (event.venue*/}
              {/*    ? ` • ${event.organizer.name}`*/}
              {/*    : event.organizer.name)}*/}
            </div>
          </div>
        </div>

        {/* Friends Going - pinned to bottom right of the full card */}
        {goingUsers.length > 0 && (
          <div className="absolute bottom-2 right-2">
            <AvatarStack users={goingUsers} maxDisplay={3} size="sm" />
          </div>
        )}
      </Card>
    </Link>
  );
}
