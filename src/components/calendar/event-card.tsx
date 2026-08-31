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
import { Megaphone, Calendar, Star } from "lucide-react";
import { format } from "date-fns";
import { EventSocialOverlay } from "@/components/events/event-social-overlay";
import {
  getEventImageUrl,
  getGoingSocialUsers,
  getInterestedCount,
  type EventCardItem,
} from "@/components/events/event-card-helpers";
import { useEventCardLink } from "@/components/events/use-event-card-link";
import { getEventStatusLabel } from "@/lib/event-status";
import { useImageDominantColor } from "@/hooks/use-image-dominant-color";

interface EventCardProps {
  event: EventCardItem;
}

export function EventCard({ event }: EventCardProps) {
  const { eventHref, handleClick } = useEventCardLink(
    event.publicId,
    event.promo,
    event.promoUrl
  );
  const dayOfWeek = formatEventDate(
    event.startAt,
    event.timeZone,
    event.state,
    {
      weekday: "short",
    }
  );
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

  const socialUsers = getGoingSocialUsers(event);
  const interestedCount = getInterestedCount(event);
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
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, transparent 0%, color-mix(in srgb, ${shelfColor} 10%, transparent) 20%, color-mix(in srgb, ${shelfColor} 25%, transparent) 38%, color-mix(in srgb, ${shelfColor} 45%, transparent) 52%, color-mix(in srgb, ${shelfColor} 65%, transparent) 63%, color-mix(in srgb, ${shelfColor} 82%, transparent) 69%, ${shelfColor} 74%, ${shelfColor} 100%)`,
            }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,transparent_40%,rgba(0,0,0,0.08)_54%,rgba(0,0,0,0.16)_100%)]" />

          {hasInactiveStatus && (
            <div className="absolute inset-x-3 top-3 z-10">
              <span className="inline-flex rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur">
                {getEventStatusLabel(event.status)}
              </span>
            </div>
          )}

          {event.promo || event.promoUrl ? (
            <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5">
              <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-neon-teal shadow-[0_1px_6px_rgba(0,0,0,0.7)] px-2 py-1 text-[10px] font-medium leading-none text-black">
                <Megaphone aria-label="Promotion" className="h-3.5 w-3.5 shrink-0 text-black" />
                <span className="truncate">{event.promo || "View Promo"}</span>
              </span>
            </div>
          ) : null}

          <div className="font-space-grotesk relative z-10 mt-auto space-y-1 px-4 pb-4 pt-28 text-white md:px-5 md:pb-5">
            <EventSocialOverlay
              users={socialUsers}
              size="md"
              placement="inline"
              reverse
              stackClassName="mb-1"
            />
            <h3 className="line-clamp-1 text-base/5 font-semibold tracking-tight transition-colors group-hover:text-white">
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

            <div className="flex min-w-0 items-center gap-2">
              <div className="line-clamp-1 min-w-0 flex-1 text-sm font-medium leading-tight text-white/75">
                {subtitle}
              </div>
              {interestedCount > 0 && (
                <div
                  className="flex shrink-0 items-center gap-1 text-xs font-semibold leading-none text-yellow-400"
                  aria-label={`${interestedCount} ${interestedCount === 1 ? "person" : "people"} interested`}
                >
                  <Star
                    className="h-3.5 w-3.5 fill-current"
                    aria-hidden="true"
                  />
                  <span>{interestedCount}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
