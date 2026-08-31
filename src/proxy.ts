import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { PUBLIC_EVENT_PATH_PATTERN } from "@/lib/public-id";

const isPublicRoute = createRouteMatcher([
  PUBLIC_EVENT_PATH_PATTERN,
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",
  "/api/webhooks/clerk(.*)",
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
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
