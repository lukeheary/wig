import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { Card } from "@/components/ui/card";
import { truculenta } from "@/lib/fonts";
import { WigLogo } from "@/components/ui/wig-logo";
import { LandingPageRedirect } from "@/components/landing-page-redirect";
import { LandingEventsPreview } from "@/components/landing/landing-events-preview";

export default async function LandingPage() {
  const { userId } = await auth();

  if (userId) {
    redirect("/home");
  }

  const fakeAvatarsByEvent = {
    rooftop: [
      { id: "roo-1", firstName: "Sage", lastName: null, avatarImageUrl: null },
      { id: "roo-2", firstName: "Owen", lastName: null, avatarImageUrl: null },
      { id: "roo-3", firstName: "Liv", lastName: null, avatarImageUrl: null },
      { id: "roo-4", firstName: "Ava", lastName: null, avatarImageUrl: null },
      { id: "roo-5", firstName: "Eli", lastName: null, avatarImageUrl: null },
    ],
    midnight: [
      { id: "mid-1", firstName: "Lena", lastName: null, avatarImageUrl: null },
      { id: "mid-2", firstName: "Jon", lastName: null, avatarImageUrl: null },
      { id: "mid-3", firstName: "Ari", lastName: null, avatarImageUrl: null },
      { id: "mid-4", firstName: "Maya", lastName: null, avatarImageUrl: null },
      { id: "mid-5", firstName: "Kai", lastName: null, avatarImageUrl: null },
      { id: "mid-6", firstName: "Jeff", lastName: null, avatarImageUrl: null },
    ],
    neon: [
      { id: "neo-1", firstName: "Brad", lastName: null, avatarImageUrl: null },
      { id: "neo-2", firstName: "Ivy", lastName: null, avatarImageUrl: null },
      { id: "neo-3", firstName: "Jack", lastName: null, avatarImageUrl: null },
      { id: "neo-4", firstName: "Tess", lastName: null, avatarImageUrl: null },
    ],
    vinyl: [
      { id: "vin-1", firstName: "Zoe", lastName: null, avatarImageUrl: null },
      { id: "vin-2", firstName: "Max", lastName: null, avatarImageUrl: null },
      { id: "vin-3", firstName: "Nina", lastName: null, avatarImageUrl: null },
    ],
  };

  const fakeEvents = [
    {
      id: "ev-1",
      title: "Rooftop Reverie",
      date: "Sat, Feb 8",
      time: "6:00 PM",
      venue: "Solstice Terrace",
      image: "/landing/rooftop-reverie.png",
      avatars: fakeAvatarsByEvent.rooftop,
    },
    {
      id: "ev-2",
      title: "Midnight Frequencies",
      date: "Sat, Feb 8",
      time: "10:00 PM",
      venue: "Skyline Hall",
      image: "/landing/midnight-frequencies.png",
      avatars: fakeAvatarsByEvent.midnight,
    },
    {
      id: "ev-3",
      title: "Neon Afterhours",
      date: "Sun, Feb 9",
      time: "2:00 AM",
      venue: "District 9",
      image: "/landing/neon-afterhours.png",
      avatars: fakeAvatarsByEvent.neon,
    },
    {
      id: "ev-4",
      title: "Brunch & Bass",
      date: "Sun, Feb 9",
      time: "1:00 PM",
      venue: "The Record Room",
      image: "/landing/brunch-and-bass.png",
      avatars: fakeAvatarsByEvent.vinyl,
    },
  ];

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
            <div className="relative mx-auto max-w-4xl text-center">
              {/* The Moon Container */}
              <div className="relative mx-auto mb-[-70px] flex h-[300px] w-[300px] items-center justify-center rounded-full bg-gradient-to-b from-white/[0.10] to-background shadow-[0_0_50px_-12px_rgba(255,255,255,0.1)] md:h-[400px] md:w-[400px]">
                <h1 className="relative z-10">
                  <span
                    className={`${truculenta.className} text-[150px] font-black tracking-wide text-white/20 md:text-[180px]`}
                  >
                    WIG
                  </span>
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

              <div className="mx-auto mt-8 flex flex-wrap items-center justify-center gap-3">
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

          {/* Mock Events Preview - Same width as /home */}
          <section className="container mx-auto px-4 md:pt-20">
            <div className="relative">
              {/* Subtle glow effects */}
              {/*<div className="pointer-events-none absolute -left-20 top-10 h-60 w-60 rounded-full bg-[#7cc3ff]/20 blur-3xl" />*/}
              {/*<div className="pointer-events-none absolute -right-20 top-20 h-48 w-48 rounded-full bg-orange-400/15 blur-3xl" />*/}

              {/* Mock date header - like /home */}
              {/* Event Cards Grid - Responsive: rows on mobile, grid on desktop */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {fakeEvents.map((event) => (
                  <Card
                    key={event.id}
                    className="overflow-hidden !border-none bg-card p-2"
                  >
                    {/* Container - horizontal on mobile, vertical on desktop */}
                    <div className="relative flex md:block">
                      {/* Image - small square on mobile, full width on desktop */}
                      <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-2xl bg-muted md:aspect-square md:h-auto md:w-full">
                        <img
                          src={event.image}
                          alt={event.title}
                          className="h-full w-full object-cover"
                        />
                      </div>

                      {/* Event Info - right on mobile, below on desktop */}
                      <div className="flex-1 space-y-1 py-1 pl-3 pr-1 md:px-1 md:py-3">
                        <h3 className="line-clamp-2 text-base font-bold leading-tight">
                          {event.title}
                        </h3>
                        <div className="text-sm text-primary/70">
                          {event.date} at {event.time}
                        </div>
                        <div className="text-sm text-primary/70">
                          {event.venue}
                        </div>
                      </div>

                      {/* Avatar stack - bottom right of card */}
                      <div className="absolute bottom-2 right-2">
                        <AvatarStack
                          users={event.avatars}
                          maxDisplay={3}
                          size="sm"
                        />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          {/* Features Section */}
          <section className="container mx-auto px-4 py-20 md:py-28">
            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-2xl border bg-background/70 p-6 backdrop-blur">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Discover
                </div>
                <h3 className="mt-3 text-2xl font-semibold">
                  Events that fit your vibe
                </h3>
                <p className="mt-2 text-muted-foreground">
                  Personalized discovery that puts your city&apos;s best nights
                  in one feed.
                </p>
              </div>
              <div className="rounded-2xl border bg-background/70 p-6 backdrop-blur">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Connect
                </div>
                <h3 className="mt-3 text-2xl font-semibold">
                  See who&apos;s in
                </h3>
                <p className="mt-2 text-muted-foreground">
                  Know what your friends are planning so you can actually meet
                  up.
                </p>
              </div>
              <div className="rounded-2xl border bg-background/70 p-6 backdrop-blur">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Go
                </div>
                <h3 className="mt-3 text-2xl font-semibold">Plan in seconds</h3>
                <p className="mt-2 text-muted-foreground">
                  RSVP, share, and coordinate without the group chat chaos.
                </p>
              </div>
            </div>
          </section>

          {/* Live Events Preview */}
          <section className="container mx-auto px-4 pb-10 md:pb-16">
            <LandingEventsPreview />
          </section>

          {/* Final CTA */}
          <section className="pb-16 pt-4 md:pt-12">
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
