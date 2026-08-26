"use client";

import Image from "next/image";
import Link from "next/link";
import { Calendar, Mail } from "lucide-react";
import { useState } from "react";
import { useSignIn } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { trpc } from "@/lib/trpc";
import { cn, formatEventDate, formatEventTime } from "@/lib/utils";
import {
  getEventImageUrl,
  type EventCardItem,
} from "@/components/events/event-card-helpers";

function PreviewCard({ event }: { event: EventCardItem }) {
  const imageUrl = getEventImageUrl(event);
  const date = formatEventDate(event.startAt, event.timeZone, event.state, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <article className="relative aspect-[4/5] min-w-0 overflow-hidden rounded-2xl bg-card ring-1 ring-white/10">
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt=""
          fill
          sizes="(max-width: 767px) 72vw, 280px"
          className="object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-violet-950 via-card to-cyan-950">
          <Calendar className="size-12 text-white/20" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-4 text-white">
        <h2 className="line-clamp-2 text-base font-bold leading-tight">
          {event.title}
        </h2>
        <p className="mt-1 text-sm font-semibold text-cyan-300">
          {date} at{" "}
          {formatEventTime(event.startAt, event.timeZone, event.state)}
        </p>
        <p className="mt-1 truncate text-sm text-white/70">
          {event.venue?.name ||
            event.organizer?.name ||
            `${event.city}, ${event.state}`}
        </p>
      </div>
    </article>
  );
}

const ssoOptions = [
  {
    label: "Continue with Apple",
    strategy: "oauth_apple" as const,
    icon: <span className="text-2xl leading-none">&#63743;</span>,
  },
  {
    label: "Continue with Google",
    strategy: "oauth_google" as const,
    icon: (
      <Image
        src="/svg/google-g-logo.svg"
        alt=""
        width={24}
        height={24}
        className="size-5"
      />
    ),
  },
];

export function LandingEventsPreview() {
  const { signIn, isLoaded } = useSignIn();
  const [loadingStrategy, setLoadingStrategy] = useState<
    "oauth_apple" | "oauth_google" | null
  >(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const { data: events } = trpc.event.listPublicEventsPreview.useQuery({
    limit: 8,
  });

  const startSso = async (strategy: "oauth_apple" | "oauth_google") => {
    if (!isLoaded || !signIn || loadingStrategy) return;

    setAuthError(null);
    setLoadingStrategy(strategy);

    try {
      await signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/home",
      });
    } catch (error) {
      setAuthError(
        isClerkAPIResponseError(error)
          ? (error.errors[0]?.longMessage ?? error.errors[0]?.message)
          : "Unable to start sign in. Please try again."
      );
      setLoadingStrategy(null);
    }
  };

  return (
    <div className="relative isolate min-h-[calc(100svh-5rem)] overflow-hidden bg-black md:min-h-[calc(100svh-6rem)]">
      <div className="absolute inset-x-0 top-0 mx-auto max-w-7xl px-4 pt-7 md:px-8 md:pt-10">
        <p className="mb-4 text-xl font-bold text-white/80 md:text-2xl">
          Upcoming
        </p>
        <div className="grid auto-cols-[72%] grid-flow-col grid-rows-2 gap-4 overflow-hidden sm:auto-cols-[42%] md:grid-flow-row md:grid-cols-4 md:grid-rows-none md:gap-5">
          {(events ?? Array.from({ length: 8 })).map((event, index) =>
            event ? (
              <PreviewCard key={event.id} event={event} />
            ) : (
              <div
                key={index}
                className="aspect-[4/5] animate-pulse rounded-2xl bg-white/10"
              />
            )
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_8%,rgba(0,0,0,0.12)_28%,rgba(0,0,0,0.8)_56%,#000_74%)] md:bg-[linear-gradient(to_bottom,transparent_8%,rgba(0,0,0,0.18)_44%,#000_94%)]" />
      <div className="pointer-events-none absolute inset-0 backdrop-blur-[1.5px] md:backdrop-blur-[2px] md:[mask-image:linear-gradient(to_bottom,transparent_12%,black_74%)]" />

      <div className="relative z-10 flex min-h-[calc(100svh-5rem)] items-end justify-center px-5 pb-7 pt-[42vh] md:fixed md:inset-0 md:min-h-0 md:px-12 md:pb-10 md:pt-0 lg:pb-12">
        <section className="w-full max-w-md md:max-w-[34rem] md:rounded-[28px] md:border md:border-white/10 md:bg-black/80 md:p-8 md:shadow-2xl md:backdrop-blur-xl">
          <h1 className="text-center text-[2.35rem] font-black leading-[1.03] tracking-[-0.045em] text-white md:text-[2.7rem]">
            <span className="block md:whitespace-nowrap">Discover events</span>
            <span className="block md:whitespace-nowrap">
              &amp; see who is going
            </span>
          </h1>
          <div className="mt-6 space-y-3">
            {ssoOptions.map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => startSso(option.strategy)}
                disabled={!isLoaded || loadingStrategy !== null}
                className="relative flex min-h-14 w-full items-center justify-center rounded-xl border border-white bg-white text-base font-semibold text-black transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70"
              >
                <span
                  className="absolute left-5 flex size-6 items-center justify-center"
                  aria-hidden="true"
                >
                  {option.icon}
                </span>
                {loadingStrategy === option.strategy
                  ? "Connecting…"
                  : option.label}
              </button>
            ))}
            <Link
              href="/sign-in"
              className={cn(
                "relative flex min-h-14 w-full items-center justify-center rounded-xl border border-white/20 bg-black text-base font-semibold text-white transition-transform hover:scale-[1.01] active:scale-[0.99]"
              )}
            >
              <span
                className="absolute left-5 flex size-6 items-center justify-center"
                aria-hidden="true"
              >
                <Mail className="size-5" />
              </span>
              Continue with email
            </Link>
          </div>
          {authError ? (
            <p className="mt-3 text-center text-sm text-red-300" role="alert">
              {authError}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
