"use client";

import { cn } from "@/lib/utils";

interface EventsPlaceholderProps {
  message?: string;
  className?: string;
}

export function EventsPlaceholder({
  message = "No upcoming events scheduled",
  className,
}: EventsPlaceholderProps) {
  return (
    <div
      className={cn(
        "flex min-h-[112px] items-center justify-center rounded-lg border border-dashed md:min-h-[300px]",
        className
      )}
    >
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
