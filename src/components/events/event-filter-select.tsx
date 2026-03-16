"use client";

import { ResponsiveSelect } from "@/components/ui/responsive-select";
import { EventFilterTab } from "@/types/events";

interface EventFilterSelectProps {
  value: EventFilterTab;
  onValueChange: (value: EventFilterTab) => void;
  className?: string;
}

const OPTIONS = [
  { value: "all", label: "All Events" },
  { value: "friends", label: "Friends' Events" },
  { value: "mine", label: "My Events" },
];

export function EventFilterSelect({
  value,
  onValueChange,
  className,
}: EventFilterSelectProps) {
  return (
    <ResponsiveSelect
      value={value}
      onValueChange={(val) => onValueChange(val as EventFilterTab)}
      options={OPTIONS}
      placeholder="Filter events"
      title="Filter Events"
      className={className}
    />
  );
}
