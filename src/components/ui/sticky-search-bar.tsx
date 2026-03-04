import { cn } from "@/lib/utils";

interface StickySearchBarProps {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}

export function StickySearchBar({
  children,
  className,
  innerClassName,
}: StickySearchBarProps) {
  return (
    <div
      className={cn(
        "top-14 z-[45] -mx-4 -mt-4 bg-background px-4 pb-4 transition-shadow md:top-16 md:z-30 md:-mx-8 md:bg-background/95 md:px-8 md:backdrop-blur md:supports-[backdrop-filter]:bg-background",
        className
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-2 sm:flex-row sm:items-center",
          innerClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
