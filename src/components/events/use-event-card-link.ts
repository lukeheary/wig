"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  buildReturnTo,
  getScrollRestoreKey,
  withReturnTo,
} from "@/lib/navigation";

export function useEventCardLink(
  eventPublicId: string,
  profilePromo?: string | null,
  profilePromoUrl?: string | null
) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = buildReturnTo(pathname, searchParams);
  const promo = profilePromo?.trim();
  const params = new URLSearchParams();
  if (promo) params.set("profilePromo", promo);
  if (profilePromoUrl) params.set("profilePromoUrl", profilePromoUrl);
  const eventPath = `/event/${eventPublicId}${params.size ? `?${params}` : ""}`;
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
