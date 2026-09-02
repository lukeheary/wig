"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  ChevronLeft,
} from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { trpc } from "@/lib/trpc";
import { HomeMobileEventRail } from "@/components/events/home-mobile-event-rail";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";

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
  const { signOut } = useClerk();
  const router = useRouter();
  const utils = trpc.useUtils();
  const profileMenuRef = useRef<HTMLSelectElement>(null);
  const [eventMode, setEventMode] = useState<"upcoming" | "past">("upcoming");
  const { data, isLoading, isError } = trpc.user.getProfileByUsername.useQuery({
    username,
  });
  const { data: adminStatus } = trpc.user.isAdmin.useQuery();
  const sendRequest = trpc.friends.sendFriendRequest.useMutation({
    onSuccess: () => {
      void utils.user.getProfileByUsername.invalidate({ username });
      void utils.friends.listFriends.invalidate();
    },
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
  const profileHref = profile.isCurrentUser
    ? "/profile"
    : `/${profile.username}`;
  const friendsHref = `${profileHref}/friends`;
  const eventSections = groupProfileEvents(
    eventMode === "upcoming" ? data.upcomingEvents : data.pastEvents,
    eventMode
  );

  const shareProfile = async () => {
    const url = `${window.location.origin}${profileHref}`;
    if (navigator.share) {
      await navigator.share({ title: name, url });
      return;
    }
    await navigator.clipboard.writeText(url);
  };

  const handleSignOut = async () => {
    await signOut();
    window.location.assign("/");
  };

  const handleProfileMenuAction = async (action: string) => {
    if (profileMenuRef.current) {
      profileMenuRef.current.selectedIndex = -1;
    }

    switch (action) {
      case "edit":
        router.push("/profile/settings");
        break;
      case "share":
        await shareProfile();
        break;
      case "promoting":
        router.push("/profile/promoting");
        break;
      case "admin":
        router.push("/admin");
        break;
      case "support":
        router.push("/support");
        break;
      case "sign-out":
        await handleSignOut();
        break;
    }
  };

  return (
    <main className="min-h-screen bg-black">
      <div className="mx-auto w-full pb-12">
        <section className="relative mx-auto max-w-3xl px-4 pb-8 pt-5 md:px-8 md:pb-10 md:pt-8">
          <div
            className={
              showSettings
                ? "h-7"
                : "flex h-7 items-center justify-center px-14 md:px-16"
            }
          >
            {!showSettings ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => router.back()}
                className="absolute left-3 top-3 h-[46px] w-[46px] shrink-0 rounded-full border border-white/15 bg-[#242426]/85 text-white shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl hover:bg-[#242426]/85 md:left-8 md:top-6 md:h-12 md:w-12"
                aria-label="Go back"
              >
                <ChevronLeft className="h-[18px] w-[18px]" />
              </Button>
            ) : null}
            <p
              className={
                showSettings
                  ? "text-center text-[17px] font-bold text-white md:text-xl"
                  : "truncate text-center text-[17px] font-bold text-white md:text-xl"
              }
            >
              {profile.username}
            </p>
          </div>
          <label className="absolute right-3 top-3 flex h-[46px] w-[46px] cursor-pointer items-center justify-center rounded-full border border-white/15 bg-[#242426]/85 text-white shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl md:right-8 md:top-6 md:h-12 md:w-12">
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            <select
              ref={(select) => {
                profileMenuRef.current = select;
                if (select) select.selectedIndex = -1;
              }}
              aria-label="Profile options"
              onPointerDown={(event) => {
                event.currentTarget.selectedIndex = -1;
              }}
              onChange={(event) => {
                const action = event.target.value;
                event.currentTarget.selectedIndex = -1;
                void handleProfileMenuAction(action);
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              {showSettings ? <option value="edit">Edit Profile</option> : null}
              {showSettings && data.isPromoter ? (
                <option value="promoting">Manage Promoting</option>
              ) : null}
              <option value="share">Share Profile</option>
              {showSettings && adminStatus?.isAdmin ? (
                <option value="admin">Admin Settings</option>
              ) : null}
              {showSettings ? (
                <option value="support">Help &amp; Feedback</option>
              ) : null}
              {showSettings ? <option value="sign-out">Sign Out</option> : null}
            </select>
          </label>

          <div className="mt-12 flex items-end gap-5 md:mt-14 md:gap-8">
            <div className="relative shrink-0">
              <UserAvatar
                src={profile.avatarImageUrl}
                name={name}
                identityKey={profile.id}
                className="h-[104px] w-[104px] text-3xl md:h-36 md:w-36"
              />
              {showSettings ? (
                <Link
                  href="/profile/settings"
                  aria-label="Edit profile picture"
                  className="absolute -bottom-0.5 -right-0.5 flex h-[34px] w-[34px] items-center justify-center rounded-full border-[3px] border-black bg-[#242428] text-white shadow-lg md:h-11 md:w-11"
                >
                  <Camera className="h-4 w-4 md:h-5 md:w-5" />
                </Link>
              ) : null}
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <div className="translate-y-1.5 md:translate-y-0">
                <h1 className="truncate text-[17px] font-bold tracking-tight md:text-3xl">
                  {name}
                </h1>
                {profile.city && profile.state ? (
                  <p className="mt-0.5 text-xs font-medium text-muted-foreground md:text-base">
                    {profile.city}, {profile.state}
                  </p>
                ) : null}
              </div>

              <div
                className={`mt-3.5 grid ${profile.isCurrentUser ? "grid-cols-3" : "grid-cols-2"}`}
              >
                <Link
                  href={friendsHref}
                  className="flex flex-col transition-opacity hover:opacity-80"
                >
                  <span className="text-base font-semibold text-white md:text-2xl">
                    {data.friendCount}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground md:text-sm">
                    Friends
                  </span>
                </Link>
                <Link
                  href={profile.isCurrentUser ? "/profile/following" : "#"}
                  aria-disabled={!profile.isCurrentUser}
                  className={`flex flex-col ${
                    profile.isCurrentUser
                      ? "transition-opacity hover:opacity-80"
                      : "pointer-events-none"
                  }`}
                >
                  <span className="text-base font-semibold text-white md:text-2xl">
                    {data.followingCount}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground md:text-sm">
                    Following
                  </span>
                </Link>
                {profile.isCurrentUser ? (
                  <Link
                    href="/profile/requests"
                    className="flex flex-col transition-opacity hover:opacity-80"
                  >
                    <span className="text-base font-semibold text-white md:text-2xl">
                      {data.requestCount}
                    </span>
                    <span className="text-[11px] font-medium text-muted-foreground md:text-sm">
                      Requests
                    </span>
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
          {!profile.isCurrentUser ? (
            profile.friendStatus === "pending_received" ? (
              <Button
                asChild
                className="mt-6 h-12 w-full rounded-xl text-base font-semibold"
              >
                <Link href="/profile/requests">Respond to Request</Link>
              </Button>
            ) : (
              <Button
                type="button"
                disabled={
                  profile.friendStatus !== "none" || sendRequest.isPending
                }
                onClick={() => sendRequest.mutate({ friendUserId: profile.id })}
                className={`mt-6 h-12 w-full rounded-xl text-base font-semibold ${profile.friendStatus === "none" ? "bg-sky-300 text-black hover:bg-sky-300/90" : "border border-white/15 bg-white/[0.07] text-white opacity-100"}`}
              >
                {profile.friendStatus === "accepted"
                  ? "Friends"
                  : profile.friendStatus === "pending_sent"
                    ? "Requested"
                    : sendRequest.isPending
                      ? "Requesting..."
                      : "Add Friend"}
              </Button>
            )
          ) : null}
        </section>

        {eventMode === "upcoming" && data.promotingEvents.length > 0 ? (
          <ProfilePromotingSection events={data.promotingEvents} />
        ) : null}

        <ProfileEventSections
          sections={eventSections}
          mode={eventMode}
          onModeChange={setEventMode}
        />
      </div>
    </main>
  );
}

function ProfilePromotingSection({ events }: { events: any[] }) {
  return (
    <section className="mb-8">
      <div className="container mx-auto px-4">
        <ProfileMonthHeader title="Promoting" />
        <HomeMobileEventRail
          events={events}
          desktopLayout="rail"
          desktopBleed
        />
      </div>
    </section>
  );
}

function ProfileEventSections({
  sections,
  mode,
  onModeChange,
}: {
  sections: Array<{ title: string; events: any[] }>;
  mode: "upcoming" | "past";
  onModeChange: (mode: "upcoming" | "past") => void;
}) {
  if (sections.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <ProfileSectionHeading
          title={mode === "upcoming" ? "Upcoming" : "Past"}
          mode={mode}
          onModeChange={onModeChange}
        />
        <p className="py-12 text-center text-muted-foreground">
          No {mode} events.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {sections.map((section, index) => (
        <ProfileMonthSection
          key={section.title}
          title={section.title}
          events={section.events}
          mode={index === 0 ? mode : undefined}
          onModeChange={index === 0 ? onModeChange : undefined}
        />
      ))}
    </div>
  );
}

function ProfileSectionHeading({
  title,
  mode,
  onModeChange,
}: {
  title?: string;
  mode: "upcoming" | "past";
  onModeChange: (mode: "upcoming" | "past") => void;
}) {
  return (
    <div className="flex items-center justify-between">
      {title ? (
        <h2 className="text-[19px] font-bold tracking-tight md:text-2xl">
          {title}
        </h2>
      ) : (
        <span />
      )}
      <label className="relative flex items-center text-[13px] font-medium text-muted-foreground md:text-lg">
        <select
          aria-label="Profile events"
          value={mode}
          onChange={(event) =>
            onModeChange(event.target.value as "upcoming" | "past")
          }
          className="cursor-pointer appearance-none bg-transparent py-1 pl-3 pr-7 text-right capitalize"
        >
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 md:h-5 md:w-5" />
      </label>
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
    <div className="flex min-h-9 items-center pb-2">
      <div className="relative flex items-center">
        <button
          type="button"
          onClick={showBackToStart ? onBackToStart : undefined}
          aria-label={
            showBackToStart
              ? `${title}: scroll events back to the beginning`
              : undefined
          }
          className={`text-left text-[19px] font-bold tracking-tight md:text-2xl ${showBackToStart ? "cursor-pointer" : "cursor-default"}`}
        >
          {title}
        </button>
      </div>
    </div>
  );
}

function ProfileMonthSection({
  title,
  events,
  mode,
  onModeChange,
}: {
  title: string;
  events: any[];
  mode?: "upcoming" | "past";
  onModeChange?: (mode: "upcoming" | "past") => void;
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
      <div className="container mx-auto flex items-start justify-between px-4">
        <ProfileMonthHeader
          title={title}
          showBackToStart={canScrollBack && !isResettingScroll}
          onBackToStart={() => {
            setIsResettingScroll(true);
            setScrollToStartSignal((current) => current + 1);
          }}
        />
        {mode && onModeChange ? (
          <ProfileSectionHeading mode={mode} onModeChange={onModeChange} />
        ) : null}
      </div>
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

function groupProfileEvents(events: any[], mode: "upcoming" | "past") {
  const grouped = new Map<string, any[]>();
  const now = new Date();
  const currentWeek = startOfWeek(now, { weekStartsOn: 1 });
  const currentMonth = startOfMonth(now);

  for (const event of [...events].sort((a, b) =>
    mode === "upcoming"
      ? new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
      : new Date(b.startAt).getTime() - new Date(a.startAt).getTime()
  )) {
    const eventDate = new Date(event.startAt);
    const weeks = Math.abs(
      differenceInCalendarWeeks(
        startOfWeek(eventDate, { weekStartsOn: 1 }),
        currentWeek
      )
    );
    const months = Math.abs(
      differenceInCalendarMonths(startOfMonth(eventDate), currentMonth)
    );
    const title =
      weeks <= 3
        ? mode === "upcoming"
          ? weeks === 0
            ? "This Week"
            : weeks === 1
              ? "Next Week"
              : `In ${weeks} Weeks`
          : weeks <= 1
            ? "Last Week"
            : `${weeks} Weeks Ago`
        : mode === "upcoming"
          ? months <= 1
            ? "Next Month"
            : `In ${months} Months`
          : months <= 1
            ? "Last Month"
            : `${months} Months Ago`;
    grouped.set(title, [...(grouped.get(title) ?? []), event]);
  }

  return [...grouped.entries()].map(([title, sectionEvents]) => ({
    title,
    events: sectionEvents,
  }));
}
