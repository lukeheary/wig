"use client";

import { cn } from "@/lib/utils";

export interface MobileFilterPillOption<T extends string> {
  value: T;
  label: string;
}

interface MobileFilterPillsProps<T extends string> {
  options: readonly MobileFilterPillOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

export function MobileFilterPills<T extends string>({
  options,
  value,
  onValueChange,
  className,
}: MobileFilterPillsProps<T>) {
  return (
    <div
      className={cn(
        "flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {options.map((option) => {
        const selected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition-colors",
              selected ? "bg-sky-300 text-black" : "bg-white/[0.07] text-white"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
