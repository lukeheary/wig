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
import { Calendar, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EventSocialOverlay } from "@/components/events/event-social-overlay";
import { EventCardGrid } from "@/components/events/event-card-grid";
import {
  getEventImageUrl,
  getGoingSocialUsers,
  getInterestedCount,
  type EventCardItem,
} from "@/components/events/event-card-helpers";
import { EventCard } from "@/components/calendar/event-card";
import { useEventCardLink } from "@/components/events/use-event-card-link";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useImageDominantColor } from "@/hooks/use-image-dominant-color";
import { getEventStatusLabel } from "@/lib/event-status";
import {
  cn,
  formatEventDate,
  formatEventTime,
  splitTrailingParenthetical,
} from "@/lib/utils";

export const HOME_MOBILE_EVENT_CARD_WIDTH = 220;
const HOME_MOBILE_EVENT_CARD_GAP = 12;
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
      const rawProgress = hasHorizontalOverflow
        ? scrollContainer.scrollLeft / maxScrollLeft
        : 0;
      const clampedProgress = Math.min(1, Math.max(0, rawProgress));

      setHasOverflow(hasHorizontalOverflow);
      setCanScrollLeft(scrollContainer.scrollLeft > 4);
      setCanScrollRight(
        scrollContainer.scrollLeft + scrollContainer.clientWidth <
          scrollContainer.scrollWidth - 4
      );
      setScrollProgress(clampedProgress);
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
        "pointer-events-none absolute h-px overflow-hidden transition-opacity duration-300 ease-out",
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
  onCanScrollBackChange,
  scrollToStartSignal,
}: {
  children: ReactNode;
  desktopBleed: boolean;
  onCanScrollBackChange?: (value: boolean) => void;
  scrollToStartSignal?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    canScrollLeft,
    canScrollRight,
    scrollProgress,
    hasOverflow,
    isScrollActive,
  } = useHorizontalScrollProgress(scrollRef, [children]);

  useEffect(() => {
    onCanScrollBackChange?.(canScrollLeft);
  }, [canScrollLeft, onCanScrollBackChange]);

  useEffect(() => {
    if (!scrollToStartSignal) return;
    scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [scrollToStartSignal]);

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
      {/*<RailProgressIndicator*/}
      {/*  scrollProgress={scrollProgress}*/}
      {/*  hasOverflow={hasOverflow}*/}
      {/*  isScrollActive={isScrollActive}*/}
      {/*  className="inset-x-0 -bottom-[4] z-20"*/}
      {/*/>*/}

      <div className="relative">
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
          <div className="absolute inset-y-0 left-0 z-10 hidden w-24 md:block">
            <button
              type="button"
              aria-label="Scroll events left"
              onClick={() => handleScroll("left")}
              className="absolute inset-0 bg-gradient-to-r from-background via-background/95 via-40% to-transparent text-foreground opacity-100 transition-opacity duration-200"
            >
              <ChevronLeft className="absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]" />
            </button>
          </div>
        ) : null}

        {canScrollRight ? (
          <div className="absolute inset-y-0 right-0 z-10 hidden w-24 md:block">
            <button
              type="button"
              aria-label="Scroll events right"
              onClick={() => handleScroll("right")}
              className="absolute inset-0 bg-gradient-to-l from-background via-background/95 via-40% to-transparent text-foreground opacity-100 transition-opacity duration-200"
            >
              <ChevronRight className="absolute right-4 top-1/2 h-6 w-6 -translate-y-1/2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MobileRailScroller({
  events,
  onCanScrollBackChange,
  scrollToStartSignal,
  onScrollCounterChange,
}: {
  events: EventCardItem[];
  onCanScrollBackChange?: (value: boolean) => void;
  scrollToStartSignal?: number;
  onScrollCounterChange?: (state: {
    current: number;
    total: number;
    visible: boolean;
  }) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const counterFadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const { canScrollLeft, scrollProgress, hasOverflow, isScrollActive } =
    useHorizontalScrollProgress(scrollRef, [events]);

  useEffect(() => {
    onCanScrollBackChange?.(canScrollLeft);
  }, [canScrollLeft, onCanScrollBackChange]);

  useEffect(() => {
    if (!scrollToStartSignal) return;
    scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [scrollToStartSignal]);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || !onScrollCounterChange) return;

    const updateCounter = () => {
      const current = Math.min(
        events.length,
        Math.max(
          1,
          Math.round(
            scrollContainer.scrollLeft /
              (HOME_MOBILE_EVENT_CARD_WIDTH + HOME_MOBILE_EVENT_CARD_GAP)
          ) + 1
        )
      );

      onScrollCounterChange({
        current,
        total: events.length,
        visible: events.length > 1,
      });

      if (counterFadeTimeoutRef.current) {
        clearTimeout(counterFadeTimeoutRef.current);
      }
      counterFadeTimeoutRef.current = setTimeout(() => {
        onScrollCounterChange({
          current,
          total: events.length,
          visible: false,
        });
      }, 450);
    };

    scrollContainer.addEventListener("scroll", updateCounter, {
      passive: true,
    });

    return () => {
      scrollContainer.removeEventListener("scroll", updateCounter);
      if (counterFadeTimeoutRef.current) {
        clearTimeout(counterFadeTimeoutRef.current);
      }
      onScrollCounterChange({
        current: 1,
        total: events.length,
        visible: false,
      });
    };
  }, [events.length, onScrollCounterChange]);

  return (
    <div className="relative md:hidden">
      {/*<RailProgressIndicator*/}
      {/*  scrollProgress={scrollProgress}*/}
      {/*  hasOverflow={hasOverflow}*/}
      {/*  isScrollActive={isScrollActive}*/}
      {/*  className="-bottom-[4] -left-4 -right-4 z-10"*/}
      {/*/>*/}
      <div
        ref={scrollRef}
        className="-mx-4 touch-auto snap-x snap-mandatory scroll-px-4 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex w-max items-stretch gap-3 px-4 pb-1">
          {events.map((event) => (
            <div
              key={event.id}
              className="shrink-0 snap-start self-stretch"
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
  const { eventHref, handleClick } = useEventCardLink(event.publicId);
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
      <Card className="relative h-full cursor-pointer overflow-hidden rounded-[18px] !border-none bg-[#111116] p-0 shadow-[0_10px_30px_rgba(0,0,0,0.28)] ring-1 ring-white/[0.08] transition-all duration-300">
        <div className="relative flex h-full min-h-[284px] flex-col overflow-hidden">
          {eventImageUrl ? (
            <Image
              src={eventImageUrl}
              alt={event.title}
              fill
              sizes="224px"
              className={cn(
                "object-cover transition-transform duration-500 group-hover:scale-[1.03]",
                hasInactiveStatus && "opacity-50 blur-[2px]"
              )}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/30 via-card to-background">
              <Calendar className="h-12 w-12 text-muted-foreground/20" />
            </div>
          )}

          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, transparent 0%, color-mix(in srgb, ${shelfColor} 10%, transparent) 20%, color-mix(in srgb, ${shelfColor} 25%, transparent) 38%, color-mix(in srgb, ${shelfColor} 45%, transparent) 52%, color-mix(in srgb, ${shelfColor} 65%, transparent) 63%, color-mix(in srgb, ${shelfColor} 82%, transparent) 69%, ${shelfColor} 74%, ${shelfColor} 100%)`,
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

          <div className="font-space-grotesk relative z-10 mt-auto space-y-0.5 px-4 pb-4 pt-24 text-white">
            <h3 className="line-clamp-2 text-sm/5 font-semibold tracking-tight transition-colors group-hover:text-white">
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
                "text-[13px] font-medium leading-tight text-neon-teal",
                hasInactiveStatus && "line-through"
              )}
            >
              {dayOfWeek}, {month} {day} at {startTime}
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <div className="line-clamp-1 min-w-0 flex-1 text-[13px] font-medium leading-tight text-white/75">
                {subtitle}
              </div>
              {interestedCount > 0 && (
                <div
                  className="flex shrink-0 items-center gap-1 text-[11px] font-semibold leading-none text-yellow-400"
                  aria-label={`${interestedCount} ${interestedCount === 1 ? "person" : "people"} interested`}
                >
                  <Star className="h-3 w-3 fill-current" aria-hidden="true" />
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

export function HomeMobileEventRail({
  events,
  mobileLayout = "rail",
  desktopLayout = "grid",
  desktopBleed = false,
  onCanScrollBackChange,
  scrollToStartSignal,
  onScrollCounterChange,
}: {
  events: EventCardItem[];
  mobileLayout?: "rail" | "grid";
  desktopLayout?: "grid" | "rail";
  desktopBleed?: boolean;
  onCanScrollBackChange?: (value: boolean) => void;
  scrollToStartSignal?: number;
  onScrollCounterChange?: (state: {
    current: number;
    total: number;
    visible: boolean;
  }) => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

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
        <MobileRailScroller
          events={events}
          onCanScrollBackChange={!isDesktop ? onCanScrollBackChange : undefined}
          scrollToStartSignal={!isDesktop ? scrollToStartSignal : undefined}
          onScrollCounterChange={!isDesktop ? onScrollCounterChange : undefined}
        />
      )}

      {desktopLayout === "rail" ? (
        <DesktopRailScroller
          desktopBleed={desktopBleed}
          onCanScrollBackChange={isDesktop ? onCanScrollBackChange : undefined}
          scrollToStartSignal={isDesktop ? scrollToStartSignal : undefined}
        >
          {events.map((event) => (
            <div key={event.id} className="w-[260px] shrink-0 self-stretch">
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
