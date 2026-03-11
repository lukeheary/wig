"use client";

import { cn } from "@/lib/utils";

type CategoryPillProps = {
  label: string;
  className?: string;
};

export function CategoryPill({ label, className }: CategoryPillProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-muted/50 px-3.5 py-1.5 text-xs font-medium text-muted-foreground",
        className
      )}
    >
      {label}
    </span>
  );
}

type CategoryPillListProps = {
  categories: string[];
  categoryLabelMap?: Record<string, string>;
  className?: string;
  pillClassName?: string;
};

export function CategoryPillList({
  categories,
  categoryLabelMap,
  className,
  pillClassName,
}: CategoryPillListProps) {
  if (categories.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {categories.map((category) => (
        <CategoryPill
          key={category}
          label={categoryLabelMap?.[category] || category}
          className={cn("capitalize", pillClassName)}
        />
      ))}
    </div>
  );
}
