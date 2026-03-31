"use client";

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { format } from "date-fns";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EventSocialOverlay } from "@/components/events/event-social-overlay";
import { EventCardGrid } from "@/components/events/event-card-grid";
import {
  getEventImageUrl,
  getSocialUsers,
  type EventCardItem,
} from "@/components/events/event-card-helpers";
import { EventCard } from "@/components/calendar/event-card";
import { useEventCardLink } from "@/components/events/use-event-card-link";
import { getEventStatusLabel } from "@/lib/event-status";
import { cn, formatTime, splitTrailingParenthetical } from "@/lib/utils";

export const HOME_MOBILE_EVENT_CARD_WIDTH = 212;
const DESKTOP_RAIL_SIDE_INSET = "max(2rem, calc((100vw - 1200px) / 2 + 2rem))";
const DESKTOP_SCROLL_STEP = 320;

function useHorizontalScrollProgress(
  scrollRef: RefObject<HTMLDivElement | null>,
  deps: readonly unknown[]
) {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isScrollActive, setIsScrollActive] = useState(false);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;
    let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;

    const updateScrollState = () => {
      const maxScrollLeft =
        scrollContainer.scrollWidth - scrollContainer.clientWidth;
      const hasHorizontalOverflow = maxScrollLeft > 4;

      setHasOverflow(hasHorizontalOverflow);
      setCanScrollLeft(scrollContainer.scrollLeft > 4);
      setCanScrollRight(
        scrollContainer.scrollLeft + scrollContainer.clientWidth <
          scrollContainer.scrollWidth - 4
      );
      setScrollProgress(
        hasHorizontalOverflow ? scrollContainer.scrollLeft / maxScrollLeft : 0
      );
    };

    const handleScroll = () => {
      setIsScrollActive(true);
      if (scrollEndTimeout) {
        clearTimeout(scrollEndTimeout);
      }
      updateScrollState();
      scrollEndTimeout = setTimeout(() => {
        setIsScrollActive(false);
      }, 320);
    };

    updateScrollState();
    scrollContainer.addEventListener("scroll", handleScroll, {
      passive: true,
    });
    window.addEventListener("resize", updateScrollState);

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", updateScrollState);
      if (scrollEndTimeout) {
        clearTimeout(scrollEndTimeout);
      }
    };
  }, [scrollRef, ...deps]);

  return {
    canScrollLeft,
    canScrollRight,
    scrollProgress,
    hasOverflow,
    isScrollActive,
  };
}

function RailProgressIndicator({
  scrollProgress,
  hasOverflow,
  isScrollActive,
  className,
}: {
  scrollProgress: number;
  hasOverflow: boolean;
  isScrollActive: boolean;
  className?: string;
}) {
  if (!hasOverflow) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute h-px transition-opacity duration-300 ease-out",
        scrollProgress > 0 && isScrollActive ? "opacity-100" : "opacity-0",
        className
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-px origin-left bg-white/[0.16]"
        style={{ transform: `scaleX(${scrollProgress})` }}
      />
    </div>
  );
}

function DesktopRailScroller({
  children,
  desktopBleed,
}: {
  children: ReactNode;
  desktopBleed: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredSide, setHoveredSide] = useState<"left" | "right" | null>(null);
  const {
    canScrollLeft,
    canScrollRight,
    scrollProgress,
    hasOverflow,
    isScrollActive,
  } = useHorizontalScrollProgress(scrollRef, [children]);

  const handleScroll = (direction: "left" | "right") => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const amount = Math.max(
      DESKTOP_SCROLL_STEP,
      Math.round(scrollContainer.clientWidth * 0.72)
    );

    scrollContainer.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  return (
    <div
      className="relative hidden md:block"
      style={
        desktopBleed
          ? {
              width: "100vw",
              marginLeft: `calc(-1 * ${DESKTOP_RAIL_SIDE_INSET})`,
              maxWidth: "none",
            }
          : undefined
      }
    >
      <RailProgressIndicator
        scrollProgress={scrollProgress}
        hasOverflow={hasOverflow}
        isScrollActive={isScrollActive}
        className="inset-x-0 -bottom-[4] z-20"
      />

      <div className="relative" onMouseLeave={() => setHoveredSide(null)}>
        <div
          ref={scrollRef}
          className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div
            className={cn(
              "flex w-max items-stretch gap-4 pb-1",
              desktopBleed ? "pr-4 md:pr-6 lg:pr-8 xl:pr-10" : "px-0"
            )}
            style={
              desktopBleed
                ? {
                    paddingLeft: DESKTOP_RAIL_SIDE_INSET,
                  }
                : undefined
            }
          >
            {children}
          </div>
        </div>

        {canScrollLeft ? (
          <div
            className="absolute inset-y-0 left-0 z-10 hidden w-24 md:block"
            onMouseEnter={() => setHoveredSide("left")}
            onMouseLeave={() => setHoveredSide(null)}
          >
            <button
              type="button"
              aria-label="Scroll events left"
              onClick={() => handleScroll("left")}
              className={cn(
                "absolute inset-0 bg-gradient-to-r from-background via-background/95 via-40% to-transparent text-foreground transition-opacity duration-200",
                hoveredSide === "left"
                  ? "opacity-100"
                  : "pointer-events-none opacity-0"
              )}
            >
              <ChevronLeft className="absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]" />
            </button>
          </div>
        ) : null}

        {canScrollRight ? (
          <div
            className="absolute inset-y-0 right-0 z-10 hidden w-24 md:block"
            onMouseEnter={() => setHoveredSide("right")}
            onMouseLeave={() => setHoveredSide(null)}
          >
            <button
              type="button"
              aria-label="Scroll events right"
              onClick={() => handleScroll("right")}
              className={cn(
                "absolute inset-0 bg-gradient-to-l from-background via-background/95 via-40% to-transparent text-foreground transition-opacity duration-200",
                hoveredSide === "right"
                  ? "opacity-100"
                  : "pointer-events-none opacity-0"
              )}
            >
              <ChevronRight className="absolute right-4 top-1/2 h-6 w-6 -translate-y-1/2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MobileRailScroller({ events }: { events: EventCardItem[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { scrollProgress, hasOverflow, isScrollActive } =
    useHorizontalScrollProgress(scrollRef, [events]);

  return (
    <div className="relative md:hidden">
      <RailProgressIndicator
        scrollProgress={scrollProgress}
        hasOverflow={hasOverflow}
        isScrollActive={isScrollActive}
        className="-bottom-[4] -left-4 -right-4 z-10"
      />
      <div
        ref={scrollRef}
        className="-mx-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
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
    </div>
  );
}

function HomeMiniEventCard({ event }: { event: EventCardItem }) {
  const { eventHref, handleClick } = useEventCardLink(event.id);
  const eventDate = new Date(event.startAt);
  const month = format(eventDate, "MMM");
  const day = format(eventDate, "d");
  const startTime = formatTime(event.startAt);
  const { main: titleMain, trailingParenthetical } = splitTrailingParenthetical(
    event.title
  );
  const socialUsers = getSocialUsers(event);
  const hasInactiveStatus = event.status !== "active";
  const eventImageUrl = getEventImageUrl(event);
  const subtitle = event.venue?.name || event.organizer?.name || "TBA";

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

          <EventSocialOverlay users={socialUsers} size="md" />
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

          <div className="pt-1 text-[13px] text-primary/70">
            <span className="line-clamp-1">{subtitle}</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function HomeMobileEventRail({
  events,
  mobileLayout = "rail",
  desktopLayout = "grid",
  desktopBleed = false,
}: {
  events: EventCardItem[];
  mobileLayout?: "rail" | "grid";
  desktopLayout?: "grid" | "rail";
  desktopBleed?: boolean;
}) {
  return (
    <>
      {mobileLayout === "grid" ? (
        <div className="grid grid-cols-2 gap-3 md:hidden">
          {events.map((event) => (
            <div key={event.id} className="min-w-0">
              <HomeMiniEventCard event={event} />
            </div>
          ))}
        </div>
      ) : (
        <MobileRailScroller events={events} />
      )}

      {desktopLayout === "rail" ? (
        <DesktopRailScroller desktopBleed={desktopBleed}>
          {events.map((event) => (
            <div key={event.id} className="w-[280px] shrink-0 self-stretch">
              <EventCard event={event} />
            </div>
          ))}
        </DesktopRailScroller>
      ) : (
        <div className="hidden md:block">
          <EventCardGrid
            events={events}
            columns={{ mobile: 1, tablet: 3, desktop: 4 }}
            gap="md"
          />
        </div>
      )}
    </>
  );
}
