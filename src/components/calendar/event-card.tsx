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
import { getEventStatusLabel } from "@/lib/event-status";
import { useImageDominantColor } from "@/hooks/use-image-dominant-color";

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
  const shelfColor = useImageDominantColor(eventImageUrl);
  const subtitle = event.venue?.name || event.organizer?.name || "TBA";

  return (
    <Link href={eventHref} className="group block h-full" onClick={handleClick}>
      <Card className="relative h-full min-h-[284px] cursor-pointer overflow-hidden rounded-[18px] !border-none bg-[#111116] p-0 shadow-[0_10px_30px_rgba(0,0,0,0.28)] ring-1 ring-white/[0.08] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:ring-white/[0.14] md:min-h-[350px]">
        <div className="relative flex h-full min-h-[284px] flex-col overflow-hidden md:min-h-[350px]">
          {eventImageUrl ? (
            <Image
              src={eventImageUrl}
              alt={event.title}
              fill
              sizes="(max-width: 768px) 50vw, 280px"
              className={cn(
                "object-cover transition-transform duration-500 group-hover:scale-[1.03]",
                hasInactiveStatus && "opacity-50 blur-[2px]"
              )}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/30 via-card to-background">
              <Calendar className="h-16 w-16 text-muted-foreground/20" />
            </div>
          )}

          <div
            className="absolute inset-x-0 bottom-0 h-[48%]"
            style={{
              background: `linear-gradient(to bottom, transparent 0%, ${shelfColor} 45%, ${shelfColor} 100%)`,
            }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,transparent_40%,rgba(0,0,0,0.08)_54%,rgba(0,0,0,0.16)_100%)]" />

          <EventSocialOverlay
            users={socialUsers}
            size="lg"
            placement="top-right"
            stackClassName="drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
          />

          {hasInactiveStatus && (
            <div className="absolute inset-x-3 top-3 z-10">
              <span className="inline-flex rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur">
                {getEventStatusLabel(event.status)}
              </span>
            </div>
          )}

          <div className="font-space-grotesk relative z-10 mt-auto space-y-1 px-4 pb-4 pt-28 text-white md:px-5 md:pb-5">
            <h3 className="line-clamp-2 text-base/5 font-semibold tracking-tight transition-colors group-hover:text-white">
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
                "text-sm font-medium leading-tight text-neon-teal",
                hasInactiveStatus && "line-through"
              )}
            >
              {dayOfWeek}, {month} {day} at {startTime}
            </div>

            <div className="line-clamp-1 text-sm font-medium leading-tight text-white/75">
              {subtitle}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
