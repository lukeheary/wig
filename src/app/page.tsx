import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Viewport } from "next";
import { Button } from "@/components/ui/button";
import { WigLogo } from "@/components/ui/wig-logo";
import { LandingPageRedirect } from "@/components/landing-page-redirect";
import { LandingEventsPreview } from "@/components/landing/landing-events-preview";
import { LandingGetStartedLink } from "@/components/landing/landing-get-started-link";

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#1B1B1D",
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
      <div className="flex min-h-screen flex-col overflow-x-hidden">
        {/* Navigation */}
        <header className="sticky top-0 z-50 bg-card">
          <div className="container mx-auto flex h-14 items-center justify-between px-4 md:h-16">
            <WigLogo asLink={false} />
            <div className="flex items-center gap-2">
              <Link href="/sign-in">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link href="/sign-up">
                <Button>Sign Up</Button>
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 bg-background">
          {/* Hero, skyline, and explainer cards are hidden so events lead the landing page. */}

          {/* Fake hero events are parked for now in favor of a live recent-activity demo. */}
          {/* <AnimatedLandingEvents events={fakeEvents} /> */}

          <section className="mx-auto pb-4 pt-4 md:pt-6">
            <LandingEventsPreview />
          </section>

          <footer className="bg-card/40 pb-8 pt-4 md:pb-12">
            <div className="container mx-auto px-4">
              <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-8">
                <div className="space-y-3">
                  <div className="inline-flex">
                    <WigLogo asLink={false} />
                  </div>
                  <h2 className="font-space-grotesk text-3xl font-semibold leading-[0.98] tracking-tight md:text-4xl">
                    <span>See who is going.</span>
                  </h2>
                  <Link
                    href="/privacy"
                    className="inline-block text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    Privacy Policy
                  </Link>
                </div>

                <div className="flex w-full flex-row gap-3 md:ml-auto md:w-auto md:flex-none">
                  <div className="min-w-0 flex-1 md:min-w-[168px] md:flex-none">
                    <LandingGetStartedLink
                      location="footer"
                      className="block"
                      buttonClassName="w-full"
                    />
                  </div>
                  <Link
                    href="/sign-in"
                    className="min-w-0 flex-1 md:min-w-[168px] md:flex-none"
                  >
                    <Button size="lg" variant="outline" className="w-full">
                      Sign In
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </>
  );
}
