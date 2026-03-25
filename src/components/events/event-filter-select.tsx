"use client";

import { ResponsiveSelect } from "@/components/ui/responsive-select";
import { EventFilterTab } from "@/types/events";

interface EventFilterSelectProps {
  value: EventFilterTab;
  onValueChange: (value: EventFilterTab) => void;
  className?: string;
  allowPersonalFilters?: boolean;
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
  allowPersonalFilters = true,
}: EventFilterSelectProps) {
  const options = allowPersonalFilters ? OPTIONS : [OPTIONS[0]];

  return (
    <ResponsiveSelect
      value={value}
      onValueChange={(val) => onValueChange(val as EventFilterTab)}
      options={options}
      placeholder="Filter events"
      title="Filter Events"
      className={className}
    />
  );
}
