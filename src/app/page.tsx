import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { WigLogo } from "@/components/ui/wig-logo";
import { LandingPageRedirect } from "@/components/landing-page-redirect";
import { LandingEventsPreview } from "@/components/landing/landing-events-preview";

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
  viewportFit: "cover",
};

export default async function LandingPage() {
  const { userId } = await auth();

  if (userId) {
    redirect("/home");
  }

  /*
  const fakeAvatarsByEvent = { ... };
  const fakeEvents = [ ... ];
  */

  return (
    <>
      <LandingPageRedirect />
      <div className="flex min-h-screen flex-col overflow-x-hidden bg-black">
        {/* Navigation */}
        <header className="sticky top-0 z-50 bg-black">
          <div className="container mx-auto flex h-20 items-center justify-center px-4 pt-3 md:h-24 md:pt-4">
            <WigLogo asLink={false} className="size-14 md:size-16" />
          </div>
        </header>

        <main className="flex-1 bg-background">
          {/* Hero, skyline, and explainer cards are hidden so events lead the landing page. */}

          {/* Fake hero events are parked for now in favor of a live recent-activity demo. */}
          {/* <AnimatedLandingEvents events={fakeEvents} /> */}

          <section>
            <LandingEventsPreview />
          </section>
        </main>
      </div>
    </>
  );
}
