"use client";

import {
  EventCard,
  type EventCardItem,
} from "@/components/calendar/event-card";
import { cn } from "@/lib/utils";

interface EventCardGridProps {
  events: EventCardItem[];
  columns?: {
    mobile: number;
    tablet?: number;
    desktop: number;
  };
  gap?: "sm" | "md" | "lg";
  className?: string;
}

export function EventCardGrid({
  events,
  columns = { mobile: 2, desktop: 4 },
  gap = "md",
  className,
}: EventCardGridProps) {
  const gapClasses = {
    sm: "gap-2",
    md: "gap-4",
    lg: "gap-4 lg:gap-6",
  };

  // Map column numbers to Tailwind classes (must be complete strings for purging)
  const mobileColsMap: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
  };

  const tabletColsMap: Record<number, string> = {
    1: "md:grid-cols-1",
    2: "md:grid-cols-2",
    3: "md:grid-cols-3",
    4: "md:grid-cols-4",
  };

  const desktopColsMap: Record<number, string> = {
    1: "lg:grid-cols-1",
    2: "lg:grid-cols-2",
    3: "lg:grid-cols-3",
    4: "lg:grid-cols-4",
  };

  const gridClasses = cn(
    mobileColsMap[columns.mobile],
    columns.tablet && tabletColsMap[columns.tablet],
    desktopColsMap[columns.desktop]
  );

  return (
    <div className={cn("grid", gridClasses, gapClasses[gap], className)}>
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}
