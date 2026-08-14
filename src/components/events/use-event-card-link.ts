"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  buildReturnTo,
  getScrollRestoreKey,
  withReturnTo,
} from "@/lib/navigation";

export function useEventCardLink(eventPublicId: string) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = buildReturnTo(pathname, searchParams);
  const eventHref = withReturnTo(`/event/${eventPublicId}`, returnTo);

  const handleClick = () => {
    if (typeof window === "undefined") return;

    const currentPath = `${window.location.pathname}${window.location.search}`;
    window.sessionStorage.setItem(
      getScrollRestoreKey(currentPath),
      String(window.scrollY)
    );
  };

  return { eventHref, handleClick };
}
