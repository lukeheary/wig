"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";

type LandingGetStartedLinkProps = {
  location: "hero" | "footer";
};

export function LandingGetStartedLink({
  location,
}: LandingGetStartedLinkProps) {
  return (
    <Link
      href="/sign-up"
      onClick={() => {
        sendGoogleAnalyticsEvent("landing_get_started_clicked", null, {
          location,
        });
      }}
    >
      <Button size="lg" className={location === "hero" ? "md:w-full" : undefined}>
        Get Started
      </Button>
    </Link>
  );
}
