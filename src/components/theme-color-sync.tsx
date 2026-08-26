"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const DEFAULT_THEME_COLOR = "#000000";
const LANDING_THEME_COLOR = "#000000";

function upsertMetaTag(name: string, content: string) {
  let element = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);

  if (!element) {
    element = document.createElement("meta");
    element.name = name;
    document.head.appendChild(element);
  }

  element.content = content;
}

export function ThemeColorSync() {
  const pathname = usePathname();

  useEffect(() => {
    const themeColor =
      pathname === "/" ? LANDING_THEME_COLOR : DEFAULT_THEME_COLOR;

    upsertMetaTag("theme-color", themeColor);
  }, [pathname]);

  return null;
}
