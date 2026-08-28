"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  buildReturnTo,
  getScrollRestoreKey,
  withReturnTo,
} from "@/lib/navigation";

export function useEventCardLink(
  eventPublicId: string,
  profilePromo?: string | null
) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = buildReturnTo(pathname, searchParams);
  const promo = profilePromo?.trim();
  const eventPath = promo
    ? `/event/${eventPublicId}?profilePromo=${encodeURIComponent(promo)}`
    : `/event/${eventPublicId}`;
  const eventHref = withReturnTo(eventPath, returnTo);

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
