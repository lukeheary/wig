import { isProduction } from "@/lib/env";

export const GOOGLE_ANALYTICS_ID = "G-7DZ5YWHS4N";
export const GOOGLE_ANALYTICS_EXCLUDED_USER_ID = "user_3A5qsDzSX1NPRfpcqfOTLEb2aOG";

type GoogleAnalyticsEventParams = Record<
  string,
  string | number | boolean | null | undefined
>;

type GtagFunction = (
  command: "event" | "config" | "js",
  target: string | Date,
  params?: GoogleAnalyticsEventParams
) => void;

function getGtag(): GtagFunction | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as Window & { gtag?: GtagFunction }).gtag;
}

export function shouldSendGoogleAnalyticsEvent(userId?: string | null): boolean {
  return (
    isProduction() &&
    userId !== GOOGLE_ANALYTICS_EXCLUDED_USER_ID &&
    typeof window !== "undefined" &&
    typeof getGtag() === "function"
  );
}

export function sendGoogleAnalyticsEvent(
  eventName: string,
  userId?: string | null,
  params?: GoogleAnalyticsEventParams
): void {
  if (!shouldSendGoogleAnalyticsEvent(userId)) {
    return;
  }

  getGtag()?.("event", eventName, params);
}
