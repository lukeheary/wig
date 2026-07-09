"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, Settings } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { HomeMobileEventRail } from "@/components/events/home-mobile-event-rail";
import { Button } from "@/components/ui/button";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn, formatEventDate } from "@/lib/utils";

type UserProfilePageProps = {
  username: string;
  isOwnProfileRoute?: boolean;
};

function displayName(profile: {
  firstName: string | null;
  lastName: string | null;
  username: string;
}) {
  return (
    [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
    profile.username
  );
}

export function UserProfilePage({
  username,
  isOwnProfileRoute = false,
}: UserProfilePageProps) {
  const { data, isLoading, isError } = trpc.user.getProfileByUsername.useQuery({
    username,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
        <h1 className="text-3xl font-bold">Profile not found</h1>
        <p className="mt-2 text-muted-foreground">
          This username does not belong to a WIG profile.
        </p>
      </div>
    );
  }

  const { profile } = data;
  const name = displayName(profile);
  const showSettings = isOwnProfileRoute || profile.isCurrentUser;
  const profileHref = profile.isCurrentUser ? "/profile" : `/${profile.username}`;
  const friendsHref = `${profileHref}/friends`;
  const eventSections = groupEventsByMonth([
    ...data.upcomingEvents,
    ...data.pastEvents,
  ]);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full pb-12">
        <section className="container relative mx-auto px-4 pb-5 pt-6 md:pb-7 md:pt-8">
          {showSettings ? (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 rounded-full bg-white/10 text-white hover:bg-white/15 md:right-6 md:top-6"
              asChild
            >
              <Link href="/profile/settings" aria-label="Profile settings">
                <Settings className="h-5 w-5" />
              </Link>
            </Button>
          ) : null}

          <div className="flex flex-col items-center text-center">
            <UserAvatar
              src={profile.avatarImageUrl}
              name={name}
              className="h-24 w-24 text-3xl md:h-28 md:w-28"
            />
            <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
              {name}
            </h1>
            <p className="mt-0.5 text-lg font-semibold text-muted-foreground">
              @{profile.username}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-base font-medium text-muted-foreground">
              {profile.city && profile.state ? (
                <span>
                  {profile.city}, {profile.state}
                </span>
              ) : null}
              <Link
                href={friendsHref}
                className="transition-colors hover:text-foreground"
              >
                <span className="font-semibold text-foreground">
                  {data.friendCount}
                </span>{" "}
                Friends
              </Link>
              {profile.isCurrentUser ? (
                <Link
                  href="/profile/requests"
                  className="transition-colors hover:text-foreground"
                >
                  <span className="font-semibold text-foreground">
                    {data.requestCount}
                  </span>{" "}
                  Requests
                </Link>
              ) : null}
              {profile.friendStatus !== "none" && !profile.isCurrentUser ? (
                <span className="capitalize">
                  {profile.friendStatus.replace("_", " ")}
                </span>
              ) : null}
            </div>
          </div>
        </section>

        <ProfileEventSections sections={eventSections} />
      </div>
    </main>
  );
}

function ProfileEventSections({
  sections,
}: {
  sections: Array<{ title: string; events: any[] }>;
}) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <ProfileMonthSection
          key={section.title}
          title={section.title}
          events={section.events}
        />
      ))}
    </div>
  );
}

function ProfileMonthHeader({
  title,
  showBackToStart = false,
  onBackToStart,
}: {
  title: string;
  showBackToStart?: boolean;
  onBackToStart?: () => void;
}) {
  return (
    <StickySectionHeader
      leadingSlotVisible={showBackToStart}
      leadingSlot={
        <button
          type="button"
          aria-label="Scroll back to the beginning of this row"
          aria-hidden={!showBackToStart}
          tabIndex={showBackToStart ? 0 : -1}
          disabled={!showBackToStart}
          onClick={onBackToStart}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-all duration-300 ease-out",
            showBackToStart
              ? "translate-x-0 opacity-100"
              : "pointer-events-none translate-x-1 opacity-0"
          )}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      }
    >
      <span>{title}</span>
    </StickySectionHeader>
  );
}

function ProfileMonthSection({
  title,
  events,
}: {
  title: string;
  events: any[];
}) {
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [scrollToStartSignal, setScrollToStartSignal] = useState(0);
  const [isResettingScroll, setIsResettingScroll] = useState(false);

  useEffect(() => {
    if (!canScrollBack) {
      setIsResettingScroll(false);
    }
  }, [canScrollBack]);

  return (
    <section>
      <ProfileMonthHeader
        title={title}
        showBackToStart={canScrollBack && !isResettingScroll}
        onBackToStart={() => {
          setIsResettingScroll(true);
          setScrollToStartSignal((current) => current + 1);
        }}
      />
      <div className="container mx-auto px-4">
        <HomeMobileEventRail
          events={events}
          desktopLayout="rail"
          desktopBleed
          onCanScrollBackChange={setCanScrollBack}
          scrollToStartSignal={scrollToStartSignal}
        />
      </div>
    </section>
  );
}

function groupEventsByMonth(events: any[]) {
  const grouped = new Map<string, any[]>();

  for (const event of [...events].sort(
    (a, b) =>
      new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  )) {
    const title = formatEventDate(event.startAt, event.timeZone, event.state, {
      month: "long",
      year: "numeric",
    });
    grouped.set(title, [...(grouped.get(title) ?? []), event]);
  }

  return [...grouped.entries()].map(([title, sectionEvents]) => ({
    title,
    events: sectionEvents,
  }));
}
