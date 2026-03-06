"use client";

import { useEffect, useRef, useState } from "react";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { Card } from "@/components/ui/card";

type LandingAvatar = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatarImageUrl: string | null;
};

type LandingEvent = {
  id: string;
  title: string;
  date: string;
  time: string;
  venue: string;
  image: string;
  avatars: LandingAvatar[];
};

export function AnimatedLandingWord({
  wordClassName,
}: {
  wordClassName: string;
}) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsVisible(true);
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <h1
      className={`relative z-10 transition-opacity ease-out ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      style={{ transitionDuration: "4000ms" }}
    >
      <span
        className={`${wordClassName} text-[150px] font-black tracking-wide text-white/20 md:text-[180px]`}
      >
        WIG
      </span>
    </h1>
  );
}

export function AnimatedLandingEvents({ events }: { events: LandingEvent[] }) {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 0) {
        setHasScrolled(true);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        threshold: 0.15,
      }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  const shouldReveal = hasScrolled && isInView;

  return (
    <div
      ref={sectionRef}
      className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4"
    >
      {events.map((event, index) => (
        <Card
          key={event.id}
          className={`overflow-hidden !border-none bg-card p-2 transition-all duration-700 ease-out ${
            shouldReveal
              ? "translate-y-0 opacity-100"
              : "translate-y-8 opacity-0"
          }`}
          style={{
            transitionDelay: shouldReveal ? `${index * 140}ms` : "0ms",
          }}
        >
          <div className="relative flex md:block">
            <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-2xl bg-muted md:aspect-square md:h-auto md:w-full">
              <img
                src={event.image}
                alt={event.title}
                className="h-full w-full object-cover"
              />
            </div>

            <div className="flex-1 space-y-1 py-1 pl-3 pr-1 md:px-1 md:py-3">
              <h3 className="line-clamp-2 text-base font-bold leading-tight">
                {event.title}
              </h3>
              <div className="text-sm text-primary/70">
                {event.date} at {event.time}
              </div>
              <div className="text-sm text-primary/70">{event.venue}</div>
            </div>

            <div className="absolute bottom-2 right-2">
              <AvatarStack users={event.avatars} maxDisplay={3} size="sm" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
