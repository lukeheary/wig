"use client";

import { useEffect, useRef } from "react";
import { SignIn, useAuth } from "@clerk/nextjs";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";

type SignInPageClientProps = {
  returnTo: string;
};

export function SignInPageClient({ returnTo }: SignInPageClientProps) {
  const { isSignedIn, userId } = useAuth();
  const hasTrackedSignInRef = useRef(false);
  const wasSignedInRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (
      isSignedIn &&
      wasSignedInRef.current === false &&
      !hasTrackedSignInRef.current
    ) {
      sendGoogleAnalyticsEvent("user_signed_in", userId, {
        destination: returnTo,
      });
      hasTrackedSignInRef.current = true;
    }

    wasSignedInRef.current = isSignedIn;
  }, [isSignedIn, returnTo, userId]);

  return (
    <SignIn
      fallbackRedirectUrl={returnTo}
      forceRedirectUrl={returnTo}
    />
  );
}
