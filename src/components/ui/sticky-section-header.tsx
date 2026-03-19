"use client";

import { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface StickySectionHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function StickySectionHeader({
  children,
  className,
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
          <div className="font-space-grotesk w-fit bg-background pr-0.5 text-xl font-semibold underline decoration-neon-teal decoration-2 underline-offset-[6px]">
            {children}
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
