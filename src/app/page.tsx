import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Viewport } from "next";
import { Button } from "@/components/ui/button";
import { truculenta } from "@/lib/fonts";
import { WigLogo } from "@/components/ui/wig-logo";
import { LandingExplainerCards } from "@/components/landing/landing-explainer-cards";
import { LandingPageRedirect } from "@/components/landing-page-redirect";
import { LandingEventsPreview } from "@/components/landing/landing-events-preview";
import { LandingHeroEventMarquee } from "@/components/landing/landing-hero-event-marquee";
import { LandingGetStartedLink } from "@/components/landing/landing-get-started-link";

const LANDING_EXPLAINERS = [
  {
    title: "See What Is Happening",
    description:
      "Browse upcoming events happening that are happening near you.",
    icon: "calendar" as const,
  },
  {
    title: "See Who Is Going",
    description:
      "Find out which of your friends are going, interested, or already have plans.",
    icon: "users" as const,
  },
  {
    title: "Decide Faster",
    description: "Less group chat back-and-forth, more spontaneous plans.",
    icon: "compass" as const,
  },
];

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
          {/* Hero Section */}
          <section className="relative flex min-h-[calc(100svh-7.5rem)] flex-col bg-card md:min-h-[calc(100svh-2rem)]">
            <div className="flex flex-1 items-center">
              <div className="relative mx-auto flex w-full max-w-6xl justify-start pb-8 pt-36 md:pb-10 md:pt-40">
                {/* The Moon Container */}
                {/*<div className="relative mx-auto mb-[-60px] flex h-[300px] w-[300px] items-center justify-center rounded-full bg-gradient-to-b from-white/[0.08] to-background shadow-[0_0_50px_-12px_rgba(255,255,255,0.1)] md:mb-[-100px] md:h-[400px] md:w-[400px]">*/}
                {/*  <h1*/}
                {/*    className={`relative z-10 text-[150px] font-black tracking-wide text-white/20 md:text-[180px]`}*/}
                {/*  >*/}
                {/*    <span className={truculenta.className}>WIG</span>*/}
                {/*  </h1>*/}
                {/*</div>*/}

                <div className="w-full text-left">
                  <h2 className="font-space-grotesk relative z-20 text-center text-[40px] font-bold leading-[1.1] tracking-tight md:text-7xl md:leading-[0.92]">
                    See who is going,
                    <br />
                    decide where to go.
                  </h2>

                  <div className="relative left-1/2 mt-5 w-screen -translate-x-1/2 overflow-hidden md:mt-8">
                    <LandingHeroEventMarquee />
                  </div>

                  <div className="mt-6 flex w-full justify-center">
                    <LandingGetStartedLink
                      location="hero"
                      className="block"
                      buttonClassName="min-w-[160px] text-base md:min-w-[228px] h-14"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Skyline transition from the sky into the page background */}
            <div className="mt-auto w-full overflow-hidden bg-card">
              {/* Mobile: Tamed background height, distinct foreground architecture */}
              <svg
                className="block h-auto w-full sm:hidden"
                viewBox="0 0 390 180"
                xmlns="http://www.w3.org/2000/svg"
                preserveAspectRatio="none"
              >
                {/* Back layer: Lowered to peek out, not tower over */}
                <path
                  d="M0 180 V128 H50 V108 H100 V133 H150 V98 H210 V128 H260 V113 H310 V133 H350 V108 H390 V180 Z"
                  fill="hsla(240, 10%, 22%, 0.72)"
                />

                {/* Front layer: Fill */}
                <path
                  d="M0 180 V145 H35 V82 H70 V107 H95 V145 H135 V32 H160 V57 H185 V145 H225 V97 H250 V77 H290 V102 H320 V127 H355 V112 H390 V180 Z"
                  fill="hsl(var(--background))"
                />

                {/* Front layer: Top-only border */}
                <path
                  d="M0 145 H35 V82 H70 V107 H95 V145 H135 V32 H160 V57 H185 V145 H225 V97 H250 V77 H290 V102 H320 V127 H355 V112 H390"
                  fill="none"
                  stroke="hsla(0,0%,100%,0.15)"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>

              {/* Desktop: Balanced silhouette heights */}
              <svg
                className="hidden h-auto w-full sm:block"
                viewBox="0 0 1200 200"
                xmlns="http://www.w3.org/2000/svg"
                preserveAspectRatio="none"
              >
                {/* Back layer: Lowered significantly from the previous version */}
                <path
                  d="M0 200 V160 H80 V130 H140 V165 H220 V140 H300 V170 H380 V115 H460 V160 H540 V130 H620 V170 H720 V145 H820 V175 H920 V120 H1020 V165 H1120 V130 H1200 V200 Z"
                  fill="hsla(240, 10%, 22%, 0.72)"
                />

                {/* Front layer: Fill */}
                <path
                  d="M0 200 V170 H40 V100 H60 V80 H80 V100 H100 V175 H160 V140 H220 V180 H280 V60 H300 V40 H320 V60 H340 V185 H400 V130 H460 V175 H520 V50 H580 V180 H640 V110 H680 V90 H720 V110 H760 V185 H840 V150 H920 V180 H980 V30 H1010 V15 H1040 V30 H1080 V185 H1140 V140 H1200 V200 Z"
                  fill="hsl(var(--background))"
                />
                {/* Front layer: Top-only border */}
                <path
                  d="M0 170 H40 V100 H60 V80 H80 V100 H100 V175 H160 V140 H220 V180 H280 V60 H300 V40 H320 V60 H340 V185 H400 V130 H460 V175 H520 V50 H580 V180 H640 V110 H680 V90 H720 V110 H760 V185 H840 V150 H920 V180 H980 V30 H1010 V15 H1040 V30 H1080 V185 H1140 V140 H1200"
                  fill="none"
                  stroke="hsla(0,0%,95%,0.15)"
                  strokeWidth="1"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </section>

          {/* Fake hero events are parked for now in favor of a live recent-activity demo. */}
          {/* <AnimatedLandingEvents events={fakeEvents} /> */}

          <section className="container mx-auto px-4 pb-8 pt-2 md:pb-14 md:pt-10">
            <LandingExplainerCards items={LANDING_EXPLAINERS} />
          </section>

          <section className="mx-auto pb-4">
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
