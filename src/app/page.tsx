import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { truculenta } from "@/lib/fonts";
import { WigLogo } from "@/components/ui/wig-logo";
import { LandingPageRedirect } from "@/components/landing-page-redirect";
import { LandingEventsPreview } from "@/components/landing/landing-events-preview";
import { LandingRecentActivity } from "@/components/landing/landing-recent-activity";

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
              {/*<Link href="/sign-up">*/}
              {/*  <Button variant={"ghost"}>Sign Up</Button>*/}
              {/*</Link>*/}
            </div>
          </div>
        </header>

        <main className="flex-1 bg-background">
          {/* Hero Section - Centered */}
          <section className="bg-card">
            <div className="relative mx-auto max-w-4xl pt-8 text-center">
              {/* The Moon Container */}
              <div className="relative mx-auto mb-[-60px] flex h-[300px] w-[300px] items-center justify-center rounded-full bg-gradient-to-b from-white/[0.08] to-background shadow-[0_0_50px_-12px_rgba(255,255,255,0.1)] md:mb-[-100px] md:h-[400px] md:w-[400px]">
                <h1
                  className={`relative z-10 text-[150px] font-black tracking-wide text-white/20 md:text-[180px]`}
                >
                  <span className={truculenta.className}>WIG</span>
                </h1>
              </div>

              {/* Hero Text */}
              <h2 className="relative z-20 text-5xl font-bold leading-[0.95] tracking-tight md:text-6xl">
                <span className={truculenta.className}>
                  See who is going,
                  <br />
                  decide where to go.
                </span>
              </h2>

              <div className="mx-auto mt-6 flex flex-wrap items-center justify-center gap-3">
                <Link href="/sign-up" className="flex-1 md:max-w-[180px]">
                  <Button size="lg" className="md:w-full">
                    Get Started
                  </Button>
                </Link>
              </div>
            </div>
          </section>

          {/* Skyline transition from the sky into the page background */}
          <div className="w-full overflow-hidden bg-card">
            {/* Mobile: Tamed background height, distinct foreground architecture */}
            <svg
              className="block h-auto w-full sm:hidden"
              viewBox="0 0 390 180"
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="none"
            >
              {/* Back layer: Lowered to peek out, not tower over */}
              <path
                d="M0 180 V140 H50 V120 H100 V145 H150 V110 H210 V140 H260 V125 H310 V145 H350 V120 H390 V180 Z"
                fill="hsla(240, 10%, 22%, 0.72)"
              />

              {/* Front layer: Fill */}
              <path
                d="M0 180 V155 H35 V100 H70 V125 H95 V155 H135 V50 H160 V75 H185 V155 H225 V115 H250 V95 H290 V120 H320 V145 H355 V130 H390 V180 Z"
                fill="hsl(var(--background))"
              />

              {/* Front layer: Top-only border */}
              <path
                d="M0 155 H35 V100 H70 V125 H95 V155 H135 V50 H160 V75 H185 V155 H225 V115 H250 V95 H290 V120 H320 V145 H355 V130 H390"
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

          {/* Fake hero events are parked for now in favor of a live recent-activity demo. */}
          {/* <AnimatedLandingEvents events={fakeEvents} /> */}

          <section className="container mx-auto px-4 pb-6 md:py-8">
            <LandingRecentActivity />
          </section>

          <section className="container mx-auto px-4 pb-10 md:pb-16">
            <LandingEventsPreview />
          </section>

          {/* Final CTA */}
          <section className="pb-12">
            <div className="container mx-auto flex flex-col items-center gap-2 px-4 text-center">
              <h2 className="text-4xl font-semibold md:text-4xl">
                <span className={truculenta.className}>See who is going.</span>
              </h2>
              <p className="max-w-lg text-muted-foreground">
                Never miss a night out with your people again.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
                <Link href="/sign-up">
                  <Button size="lg">Get Started</Button>
                </Link>
                <Link href="/sign-in">
                  <Button size="lg" variant="outline">
                    Sign In
                  </Button>
                </Link>
              </div>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
