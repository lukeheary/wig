"use client";

import { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface StickySectionHeaderProps {
  children: React.ReactNode;
  className?: string;
  leadingSlot?: React.ReactNode;
  leadingSlotVisible?: boolean;
}

export function StickySectionHeader({
  children,
  className,
  leadingSlot,
  leadingSlotVisible = false,
}: StickySectionHeaderProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [, setIsSticky] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSticky(!entry.isIntersecting);
      },
      {
        rootMargin: "-65px 0px 0px 0px",
        threshold: 0,
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.unobserve(sentinel);
    };
  }, []);

  return (
    <>
      <div ref={sentinelRef} className="h-0 w-full" />
      <div className={cn("sticky top-14 z-30 w-full md:top-16", className)}>
        <div className="container mx-auto flex flex-row px-4">
          <div className="-ml-4 flex w-fit items-center gap-2 bg-background pl-4 pr-1 md:ml-0 md:pl-0">
            <div className="pb-2">
              <div className="relative flex items-center">
                {leadingSlot ? (
                  <div className="absolute inset-y-0 left-0 flex items-center">
                    {leadingSlot}
                  </div>
                ) : null}
                {/*<span*/}
                {/*  aria-hidden*/}
                {/*  className="h-6 w-1 rounded-full bg-neon-teal shadow-[0_0_18px_rgba(0,245,212,0.5)]"*/}
                {/*/>*/}
                <div
                  className={cn(
                    "font-space-grotesk text-xl font-semibold leading-none transition-[padding] duration-300 ease-out",
                    leadingSlotVisible ? "pl-11" : "pl-0"
                  )}
                >
                  {children}
                </div>
              </div>
            </div>
          </div>
          <img
            src="/svg/header-corner.svg"
            alt=""
            aria-hidden
            width={36}
            height={36}
            className="block h-9 w-9 shrink-0"
          />
        </div>
      </div>
    </>
  );
}
