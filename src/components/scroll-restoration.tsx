"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getScrollRestoreKey } from "@/lib/navigation";

export function ScrollRestoration() {
  const pathname = usePathname();

  useEffect(() => {
    // Disable browser's automatic scroll restoration
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    const shouldSkipScrollToTop = () => window.location.hash.length > 0;
    const currentPath = `${window.location.pathname}${window.location.search}`;
    const scrollRestoreKey = getScrollRestoreKey(currentPath);
    let savedScrollY = window.sessionStorage.getItem(scrollRestoreKey);
    let hasRestoredSavedScroll = false;
    const restoreSavedScroll = () => {
      if (!savedScrollY) return false;

      const parsedScrollY = Number(savedScrollY);
      if (Number.isNaN(parsedScrollY)) {
        window.sessionStorage.removeItem(scrollRestoreKey);
        savedScrollY = null;
        return false;
      }

      window.scrollTo({ top: parsedScrollY, left: 0, behavior: "auto" });
      window.sessionStorage.removeItem(scrollRestoreKey);
      savedScrollY = null;
      hasRestoredSavedScroll = true;
      return true;
    };

    const forceTop = () => {
      if (shouldSkipScrollToTop()) return;
      if (hasRestoredSavedScroll) return;
      if (restoreSavedScroll()) return;
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };

    // Run multiple times to avoid mobile browsers restoring stale positions
    forceTop();
    requestAnimationFrame(() => {
      forceTop();
      requestAnimationFrame(forceTop);
    });

    const timeoutId = window.setTimeout(forceTop, 120);
    const onPageShow = () => forceTop();

    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.clearTimeout(timeoutId);
    };
  }, [pathname]);

  return null;
}
