"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";
import { cn } from "@/lib/utils";

type LandingGetStartedLinkProps = {
  location: "hero" | "footer";
  className?: string;
  buttonClassName?: string;
};

export function LandingGetStartedLink({
  location,
  className,
  buttonClassName,
}: LandingGetStartedLinkProps) {
  return (
    <Link
      href="/sign-up"
      className={className}
      onClick={() => {
        sendGoogleAnalyticsEvent("landing_get_started_clicked", null, {
          location,
        });
      }}
    >
      <Button
        size="lg"
        className={cn(
          location === "hero" ? "md:w-full" : undefined,
          buttonClassName
        )}
      >
        Sign Up
      </Button>
    </Link>
  );
}
