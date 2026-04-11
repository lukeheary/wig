"use client";

import Image from "next/image";
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { withImageVersion } from "@/components/events/event-card-helpers";

type LandingHeroEventMarqueeProps = {
  className?: string;
};

type MarqueeSlide = {
  id: string;
  title: string;
  imageUrl: string | null;
};

const FALLBACK_GRADIENTS = [
  "from-[#7dd3fc]/85 via-[#38bdf8]/55 to-[#0f172a]/80",
  "from-[#f9a8d4]/85 via-[#fb7185]/55 to-[#1f1524]/80",
  "from-[#fde68a]/85 via-[#f59e0b]/60 to-[#20110a]/80",
  "from-[#86efac]/80 via-[#22c55e]/55 to-[#052e16]/80",
] as const;

const MARQUEE_SLIDE_CLASS_NAME =
  "group relative h-36 w-36 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05] shadow-[0_24px_40px_-28px_rgba(0,0,0,0.95)] md:h-52 md:w-52";

function getEventImageUrl(event: {
  coverImageUrl?: string | null;
  updatedAt?: Date | string | null;
  venue?: { logoImageUrl?: string | null } | null;
  organizer?: { logoImageUrl?: string | null } | null;
}) {
  return (
    withImageVersion(event.coverImageUrl, event.updatedAt) ||
    event.venue?.logoImageUrl ||
    event.organizer?.logoImageUrl ||
    null
  );
}

function getFallbackLabel(title: string) {
  const words = title
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);

  if (words.length === 0) return "EV";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();

  return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
}

export function LandingHeroEventMarquee({
  className,
}: LandingHeroEventMarqueeProps) {
  const { data: events } = trpc.event.listPublicEventsPreview.useQuery({
    limit: 16,
  });

  const slides = useMemo<MarqueeSlide[]>(
    () =>
      (events ?? [])
        .map((event) => ({
          id: event.id,
          title: event.title,
          imageUrl: getEventImageUrl(event),
        }))
        .slice(0, 10),
    [events]
  );

  const trackSlides = useMemo(
    () => (slides.length > 0 ? [...slides, ...slides] : []),
    [slides]
  );

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {trackSlides.length > 0 ? (
        <div className="hero-event-marquee-track flex w-max gap-3 md:gap-4">
          {trackSlides.map((slide, index) => (
            <div
              key={`${slide.id}-${index}`}
              className={MARQUEE_SLIDE_CLASS_NAME}
            >
              {slide.imageUrl ? (
                <Image
                  src={slide.imageUrl}
                  alt={slide.title}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div
                  className={cn(
                    "flex h-full w-full items-center justify-center bg-gradient-to-br text-xl font-black tracking-[0.14em] text-white",
                    FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length]
                  )}
                >
                  {getFallbackLabel(slide.title)}
                </div>
              )}

              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-white/10" />
            </div>
          ))}
        </div>
      ) : (
        <div className="hero-event-marquee-track flex w-max gap-3 md:gap-4">
          {Array.from({ length: 10 }).map((_, index) => (
            <div
              key={index}
              className={cn(MARQUEE_SLIDE_CLASS_NAME, "animate-pulse")}
            >
              <div className="h-full w-full bg-white/[0.08]" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/10" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
