"use client";

import { cn } from "@/lib/utils";

type CategoryPillProps = {
  label: string;
  variant?: "default" | "small";
  className?: string;
};

export function CategoryPill({
  label,
  variant = "default",
  className,
}: CategoryPillProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-muted/50 text-xs font-medium text-muted-foreground",
        variant === "default" && "px-3.5 py-1.5",
        variant === "small" && "px-2.5 py-1",
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
  variant?: "default" | "small";
  className?: string;
  pillClassName?: string;
};

export function CategoryPillList({
  categories,
  categoryLabelMap,
  variant = "default",
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
          variant={variant}
          className={cn("capitalize", pillClassName)}
        />
      ))}
    </div>
  );
}
