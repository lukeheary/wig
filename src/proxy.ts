import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { PUBLIC_EVENT_PATH_PATTERN } from "@/lib/public-id";

const isPublicRoute = createRouteMatcher([
  PUBLIC_EVENT_PATH_PATTERN,
  "/",
  "/support",
  "/privacy",
  "/community-guidelines",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",
  "/api/webhooks/clerk(.*)",
  "/api/storage-image(.*)",
  "/api/mobile(.*)",
  "/api/trpc(.*)",
  "/api/cron(.*)",
]);

const isOnboardingRoute = createRouteMatcher(["/onboarding"]);

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  if (isOnboardingRoute(req) && !userId) {
    const signUpUrl = new URL("/sign-up", req.url);
    return NextResponse.redirect(signUpUrl);
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  // Account-filtered responses must not be reused between signed-in users.
  if (req.nextUrl.pathname.startsWith("/api/mobile/") || req.nextUrl.pathname.startsWith("/api/trpc/")) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Authorization, Cookie");
    return response;
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
