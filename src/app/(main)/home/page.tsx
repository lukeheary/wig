"use client";

import {
  useState,
  useMemo,
  useEffect,
  Suspense,
  useRef,
  useCallback,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, addDays, startOfDay, isSameMonth, isSameDay } from "date-fns";
import { useAuth } from "@clerk/nextjs";
import { useQueryState } from "nuqs";
import { CalendarIcon, Clock, ChevronRight, MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EventBrowserSurface } from "@/components/events/event-browser-surface";
import {
  WhatsNewSection,
  type WhatsNewEvent,
  type WhatsNewFilter,
  type WhatsNewUpdate,
} from "@/components/events/whats-new-section";
import { useEventBrowserState } from "@/components/events/use-event-browser-state";
import { Card, CardContent } from "@/components/ui/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  ActivityFeedList,
  useHomeActivityPreview,
} from "@/components/friends/activity-feed";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import { EventsPlaceholder } from "@/components/shared/events-placeholder";
import { useNavbarSearch } from "@/contexts/nav-search-context";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";
import { HapticPreset, useHaptics } from "@/hooks/use-haptics";
import { resolveMetroArea } from "@/lib/metro-areas";
import { withReturnTo } from "@/lib/navigation";
import { HOME_RECENT_ACTIVITY_SURFACE } from "@/lib/user-surface-state";
import { cn, formatEventDate, formatEventTime } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { type EventFilterTab } from "@/types/events";

type ViewMode = "week" | "month";
const HOME_ADD_FRIENDS_BANNER_KEY_PREFIX =
  "wig:home:add-friends-banner-dismissed";
const HOME_ACTIVITY_WINDOW_DAYS = 1;
const HOME_EVENTS_QUERY_LIMIT = 500;

type MobileWhatsNewEvent = WhatsNewEvent & {
  venueId: string | null;
  organizerId: string | null;
  seriesId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  metroAreaCity: string | null;
  isFollowed: boolean;
  venueIsFollowed: boolean;
  organizerIsFollowed: boolean;
};

type MobileEventsWhatsNewResponse = {
  latestFromPlaces?: MobileWhatsNewEvent[];
  latestFromFollows?: MobileWhatsNewEvent[];
  hasFollowedPlaces?: boolean;
};

function getFriendActivityCount(event: {
  friendsGoing?: ArrayLike<unknown> | null;
  friendsInterested?: ArrayLike<unknown> | null;
}) {
  return (
    (event.friendsGoing?.length ?? 0) + (event.friendsInterested?.length ?? 0)
  );
}

function getNativeDayRowPriority(event: {
  coverImageUrl?: string | null;
  venue?: { logoImageUrl?: string | null } | null;
  organizer?: { logoImageUrl?: string | null } | null;
  isFollowed?: boolean;
  userRsvp?: { status?: string | null } | null;
  friendsGoing?: ArrayLike<unknown> | null;
  friendsInterested?: ArrayLike<unknown> | null;
}) {
  const hasSocialRsvp =
    event.userRsvp?.status === "going" ||
    event.userRsvp?.status === "interested" ||
    getFriendActivityCount(event) > 0;

  if (hasSocialRsvp) return 0;
  if (event.isFollowed && event.coverImageUrl) return 1;
  if (event.isFollowed) return 2;
  if (
    event.coverImageUrl ||
    event.venue?.logoImageUrl ||
    event.organizer?.logoImageUrl
  ) {
    return 3;
  }
  return 4;
}

function sortEventsLikeNativeHome<
  T extends Parameters<typeof getNativeDayRowPriority>[0] & {
    startAt: Date | string;
    title: string;
  },
>(events: readonly T[]) {
  return [...events].sort((a, b) => {
    const priorityDifference =
      getNativeDayRowPriority(a) - getNativeDayRowPriority(b);
    if (priorityDifference !== 0) return priorityDifference;

    const rsvpCountDifference =
      getFriendActivityCount(b) - getFriendActivityCount(a);
    if (rsvpCountDifference !== 0) return rsvpCountDifference;

    const timeDifference =
      new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    if (timeDifference !== 0) return timeDifference;

    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}

function HomePageContent() {
  const router = useRouter();
  const { toast } = useToast();
  const { triggerHaptic } = useHaptics();
  const { userId } = useAuth();
  const utils = trpc.useUtils();
  const addFriendsBannerStorageKey = `${HOME_ADD_FRIENDS_BANNER_KEY_PREFIX}:${userId ?? "anonymous"}`;

  const [activeFilter, setActiveFilter] = useState<EventFilterTab>("all");
  const [isAddFriendsBannerDismissed, setIsAddFriendsBannerDismissed] =
    useState(false);
  const [isSticky, setIsSticky] = useState(false);
  const [isDateNavigating, setIsDateNavigating] = useState(false);
  const [whatsNewResponse, setWhatsNewResponse] =
    useState<MobileEventsWhatsNewResponse | null>(null);
  const [selectedWhatsNewFilter, setSelectedWhatsNewFilter] =
    useState<WhatsNewFilter | null>(null);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const hasMarkedHomeActivitySeenRef = useRef(false);

  const [viewMode] = useQueryState<ViewMode>("view", {
    defaultValue: "week",
    parse: (value) => (value === "month" ? "month" : "week"),
    serialize: (value) => value,
    scroll: false,
    shallow: true,
  });

  const isDefaultCalendarView = activeFilter === "all";
  const isFollowingFeed = activeFilter === "following";
  const usesDaySectionLayout = isDefaultCalendarView || isFollowingFeed;

  const browser = useEventBrowserState({
    viewMode,
    // Pass the filter-driven flag without isSearching (hook ANDs with !isSearching internally)
    isFilteredFeedView: !usesDaySectionLayout,
    onBeforeNavigate: () => setIsDateNavigating(true),
    onNavigate: ({ direction, fromDate, toDate }) => {
      sendGoogleAnalyticsEvent("home_date_navigation_clicked", userId, {
        direction,
        view_mode: viewMode,
        from_date: fromDate,
        to_date: toDate,
      });
    },
  });

  const {
    searchQuery,
    selectedCity,
    isSearching,
    isSearchView,
    isCurrentWeek,
    currentDate,
    dateRange,
    daysToDisplay,
    cityOptions,
    getVisibleCategories,
    filterByCategories,
    buildEventsByDay,
  } = browser;

  const isFilteredFeedView = !isSearching && !usesDaySectionLayout;

  const { data: currentUser, isLoading: isLoadingUser } =
    trpc.user.getCurrentUser.useQuery();
  const { data: acceptedFriends } = trpc.friends.listFriends.useQuery({
    statusFilter: "accepted",
  });
  const { data: homeActivityState, isLoading: isHomeActivityStateLoading } =
    trpc.user.getSurfaceState.useQuery({
      surface: HOME_RECENT_ACTIVITY_SURFACE,
    });
  const markSurfaceVisitedMutation = trpc.user.markSurfaceVisited.useMutation({
    onSuccess: (surfaceState) => {
      utils.user.getSurfaceState.setData(
        { surface: HOME_RECENT_ACTIVITY_SURFACE },
        surfaceState
      );
    },
    onError: () => {
      hasMarkedHomeActivitySeenRef.current = false;
    },
  });

  const {
    activities: homeActivityPreview,
    hasActivity: hasRecentActivity,
    isLoading: isHomeActivityLoading,
    shouldStartMissedWindow,
  } = useHomeActivityPreview({
    limit: 3,
    hidePastEvents: true,
    includeEventUpdates: false,
    lastVisitedAt: homeActivityState?.lastVisitedAt ?? null,
    missedWindowStartAt: homeActivityState?.missedWindowStartAt ?? null,
    missedWindowExpiresAt: homeActivityState?.missedWindowExpiresAt ?? null,
    staleAfterDays: HOME_ACTIVITY_WINDOW_DAYS,
  });

  // These queries are deduplicated with the ones inside the hook
  const { data: cities } = trpc.event.getAvailableCities.useQuery();
  const { data: activeCategories } = trpc.category.listActive.useQuery();

  const categoryLabelMap = useMemo(
    () =>
      Object.fromEntries(
        (activeCategories || []).map((category) => [
          category.key,
          category.label,
        ])
      ),
    [activeCategories]
  );

  const { setShowNavbarSearch, registerScrollToSearch } = useNavbarSearch();

  const effectiveCity = useMemo(() => {
    if (selectedCity) return selectedCity;
    if (!currentUser?.city) return null;
    if (!cities) return currentUser.city;
    const metro = resolveMetroArea(currentUser.city, currentUser.state, cities);
    return metro?.city ?? currentUser.city;
  }, [selectedCity, currentUser?.city, currentUser?.state, cities]);

  const isReady = !isLoadingUser;

  const {
    data: events,
    isLoading,
    isFetching,
    error,
  } = trpc.event.listEventsByRange.useQuery(
    {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      limit: HOME_EVENTS_QUERY_LIMIT,
      followedOnly: isFollowingFeed,
      friendsRsvpOnly: activeFilter === "friends",
      myRsvpOnly: activeFilter === "mine",
      city:
        effectiveCity && effectiveCity !== "all" ? effectiveCity : undefined,
      search: searchQuery || undefined,
    },
    {
      placeholderData: (previousData) => previousData,
      enabled: isReady,
    }
  );

  const showSkeletons = !isReady || (!events && isLoading) || isDateNavigating;

  const { data: upcomingSearchEvents, isLoading: upcomingSearchLoading } =
    trpc.event.listEventsByRange.useQuery(
      {
        startDate: startOfDay(new Date()),
        endDate: addDays(startOfDay(new Date()), 365),
        followedOnly: isFollowingFeed,
        friendsRsvpOnly: activeFilter === "friends",
        myRsvpOnly: activeFilter === "mine",
        city:
          effectiveCity && effectiveCity !== "all" ? effectiveCity : undefined,
        limit: 20,
      },
      {
        enabled: isReady && isSearchView && !isSearching,
      }
    );

  const sortedEvents = useMemo(() => {
    if (!events) return [];
    return sortEventsLikeNativeHome(events);
  }, [events]);

  const sortedUpcomingSearchEvents = useMemo(() => {
    if (!upcomingSearchEvents) return [];
    return sortEventsLikeNativeHome(upcomingSearchEvents);
  }, [upcomingSearchEvents]);

  const visibleCategories = useMemo(
    () => getVisibleCategories(sortedEvents),
    [getVisibleCategories, sortedEvents]
  );
  const filteredEvents = useMemo(
    () => filterByCategories(sortedEvents),
    [filterByCategories, sortedEvents]
  );
  const filteredUpcomingSearchEvents = useMemo(
    () => filterByCategories(sortedUpcomingSearchEvents),
    [filterByCategories, sortedUpcomingSearchEvents]
  );
  const eventsByDay = useMemo(
    () => buildEventsByDay(filteredEvents),
    [buildEventsByDay, filteredEvents]
  );

  useEffect(() => {
    if (!userId || !isCurrentWeek) {
      setWhatsNewResponse(null);
      return;
    }

    const controller = new AbortController();

    void fetch("/api/mobile/events?limit=500", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load What’s New");
        return response.json() as Promise<MobileEventsWhatsNewResponse>;
      })
      .then((response) => setWhatsNewResponse(response))
      .catch((fetchError: unknown) => {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return;
        }
        setWhatsNewResponse(null);
      });

    return () => controller.abort();
  }, [isCurrentWeek, userId]);

  const hasFollowedPlaces = whatsNewResponse?.hasFollowedPlaces ?? false;
  const effectiveWhatsNewFilter =
    selectedWhatsNewFilter ?? (hasFollowedPlaces ? "following" : "allPlaces");
  const allWhatsNewUpdates = useMemo<WhatsNewUpdate[]>(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const seenIds = new Set<string>();
    const source =
      whatsNewResponse?.latestFromPlaces ??
      whatsNewResponse?.latestFromFollows ??
      [];

    return source
      .filter((event) => {
        if (seenIds.has(event.id)) return false;
        seenIds.add(event.id);
        if (!event.venueId && !event.organizerId) return false;
        if (!effectiveCity || effectiveCity === "all") return true;
        return (
          event.metroAreaCity === effectiveCity || event.city === effectiveCity
        );
      })
      .flatMap((event): WhatsNewUpdate[] => {
        const createdAt = event.createdAt
          ? new Date(event.createdAt).getTime()
          : Number.NEGATIVE_INFINITY;
        const updatedAt = event.updatedAt
          ? new Date(event.updatedAt).getTime()
          : Number.NEGATIVE_INFINITY;
        const wasRecentlyCreated = createdAt >= cutoff;
        const wasRecentlyUpdated = updatedAt >= cutoff && updatedAt > createdAt;
        const isSeriesOccurrence = Boolean(event.seriesId);
        const qualifies = isSeriesOccurrence
          ? wasRecentlyUpdated
          : wasRecentlyCreated || wasRecentlyUpdated;

        if (!qualifies) return [];

        const kind =
          isSeriesOccurrence || (wasRecentlyUpdated && !wasRecentlyCreated)
            ? "seriesUpdated"
            : "newEvent";

        return [
          {
            event,
            kind,
            activityDate: kind === "seriesUpdated" ? updatedAt : createdAt,
          },
        ];
      })
      .sort((a, b) => {
        if (a.activityDate !== b.activityDate) {
          return b.activityDate - a.activityDate;
        }
        return (
          new Date(a.event.startAt).getTime() -
          new Date(b.event.startAt).getTime()
        );
      });
  }, [effectiveCity, whatsNewResponse]);
  const visibleWhatsNewUpdates = useMemo(
    () =>
      allWhatsNewUpdates.filter((update) => {
        if (effectiveWhatsNewFilter === "allPlaces") return true;
        return (
          (update.event as MobileWhatsNewEvent).isFollowed ||
          (update.event as MobileWhatsNewEvent).venueIsFollowed ||
          (update.event as MobileWhatsNewEvent).organizerIsFollowed
        );
      }),
    [allWhatsNewUpdates, effectiveWhatsNewFilter]
  );
  const shouldShowWhatsNew =
    Boolean(userId) &&
    isCurrentWeek &&
    isDefaultCalendarView &&
    browser.selectedCategories.length === 0 &&
    !isSearchView &&
    !isSearching &&
    !showSkeletons &&
    allWhatsNewUpdates.length > 0;

  const isHomeActivityStateReady = !isHomeActivityStateLoading;
  const shouldShowRecentActivity =
    !isSearchView &&
    !showSkeletons &&
    isHomeActivityStateReady &&
    !isHomeActivityLoading &&
    hasRecentActivity &&
    isCurrentWeek &&
    isDefaultCalendarView &&
    browser.selectedCategories.length === 0;
  const hasAcceptedFriends = (acceptedFriends?.length ?? 0) > 0;
  const shouldShowAddFriendsBanner =
    !isSearchView &&
    !isSearching &&
    !showSkeletons &&
    isDefaultCalendarView &&
    !hasAcceptedFriends &&
    !isAddFriendsBannerDismissed;
  const shouldShowWeekSectionSkeletons =
    !isSearchView && viewMode === "week" && usesDaySectionLayout;

  const skeletonDateHeader = useMemo(() => {
    if (isSearchView) return null;
    if (viewMode === "week") {
      if (isCurrentWeek) {
        return new Date().getHours() >= 17
          ? "Tonight's Events"
          : "Today's Events";
      }
      return format(dateRange.startDate, "EEE, MMM d");
    }
    return format(currentDate, "MMMM yyyy");
  }, [currentDate, dateRange.startDate, isCurrentWeek, isSearchView, viewMode]);

  const handleBackFromSearchOrFilter = useCallback(() => {
    if (isFilteredFeedView) {
      void triggerHaptic(HapticPreset.Soft);
      setActiveFilter("all");
      return;
    }
    void browser.handleExitSearch();
  }, [browser, isFilteredFeedView, triggerHaptic]);

  const scrollToSearchAndFocus = useCallback(() => {
    router.push("/activity/search?filter=events");
  }, [router]);

  useEffect(() => {
    registerScrollToSearch(scrollToSearchAndFocus);
  }, [registerScrollToSearch, scrollToSearchAndFocus]);

  useEffect(() => {
    setShowNavbarSearch(isSticky);
  }, [isSticky, setShowNavbarSearch]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsAddFriendsBannerDismissed(
      window.localStorage.getItem(addFriendsBannerStorageKey) === "true"
    );
  }, [addFriendsBannerStorageKey]);

  useEffect(() => {
    if (!hasAcceptedFriends || typeof window === "undefined") return;
    window.localStorage.removeItem(addFriendsBannerStorageKey);
    setIsAddFriendsBannerDismissed(false);
  }, [addFriendsBannerStorageKey, hasAcceptedFriends]);

  useEffect(() => {
    hasMarkedHomeActivitySeenRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (
      !isHomeActivityStateReady ||
      isHomeActivityLoading ||
      markSurfaceVisitedMutation.isPending ||
      hasMarkedHomeActivitySeenRef.current
    ) {
      return;
    }
    hasMarkedHomeActivitySeenRef.current = true;
    markSurfaceVisitedMutation.mutate({
      surface: HOME_RECENT_ACTIVITY_SURFACE,
      startMissedWindowAt: shouldStartMissedWindow
        ? (homeActivityState?.lastVisitedAt ?? null)
        : null,
      windowDays: HOME_ACTIVITY_WINDOW_DAYS,
    });
  }, [
    homeActivityState?.lastVisitedAt,
    isHomeActivityLoading,
    isHomeActivityStateReady,
    markSurfaceVisitedMutation,
    shouldStartMissedWindow,
  ]);

  useEffect(() => {
    if (error) {
      toast({
        title: "Error loading events",
        description: error.message,
        variant: "destructive",
      });
    }
  }, [error, toast]);

  useEffect(() => {
    if (!isFetching) setIsDateNavigating(false);
  }, [isFetching]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSticky(!entry.isIntersecting);
      },
      { threshold: [1], rootMargin: "-1px 0px 0px 0px" }
    );
    const sentinel = stickySentinelRef.current;
    if (sentinel) observer.observe(sentinel);
    return () => {
      if (sentinel) observer.unobserve(sentinel);
    };
  }, []);

  const handleAddFriendsBannerClick = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(addFriendsBannerStorageKey, "true");
    }
    setIsAddFriendsBannerDismissed(true);
  }, [addFriendsBannerStorageKey]);

  const monthContent =
    !isSearchView &&
    isDefaultCalendarView &&
    viewMode === "month" &&
    events &&
    !showSkeletons ? (
      <div className="container mx-auto px-4">
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 grid grid-cols-7 gap-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div
                  key={day}
                  className="py-2 text-center text-sm font-medium text-muted-foreground"
                >
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {daysToDisplay.map((date) => {
                const dateKey = format(date, "yyyy-MM-dd");
                const dayEvents = eventsByDay[dateKey] || [];
                const isToday = isSameDay(date, new Date());
                const isCurrentMonth = isSameMonth(date, currentDate);

                return (
                  <div
                    key={dateKey}
                    className={cn(
                      "min-h-[120px] rounded-lg border p-2",
                      !isCurrentMonth && "bg-muted/50 text-muted-foreground",
                      isToday && "border-primary bg-primary/5"
                    )}
                  >
                    <div
                      className={cn(
                        "mb-1 text-sm font-medium",
                        isToday && "text-primary"
                      )}
                    >
                      {format(date, "d")}
                    </div>
                    <div className="space-y-1">
                      {dayEvents.slice(0, 3).map((event) => {
                        const eventImageUrl =
                          event.coverImageUrl ||
                          event.venue?.logoImageUrl ||
                          event.organizer?.logoImageUrl ||
                          null;

                        return (
                          <HoverCard
                            key={event.id}
                            openDelay={200}
                            closeDelay={100}
                          >
                            <HoverCardTrigger asChild>
                              <div
                                className="cursor-pointer truncate rounded bg-primary/10 p-1 text-xs text-primary hover:bg-primary/20"
                                onClick={() => {
                                  const returnTo = `${window.location.pathname}${window.location.search}`;
                                  window.location.href = withReturnTo(
                                    `/event/${event.publicId}`,
                                    returnTo
                                  );
                                }}
                              >
                                {event.title}
                              </div>
                            </HoverCardTrigger>
                            <HoverCardContent
                              className="w-80"
                              side="right"
                              align="start"
                            >
                              <div className="space-y-3">
                                {eventImageUrl ? (
                                  <div className="relative h-32 w-full overflow-hidden rounded-md">
                                    <Image
                                      src={eventImageUrl}
                                      alt={event.title}
                                      fill
                                      className="object-cover"
                                    />
                                  </div>
                                ) : null}

                                <div>
                                  <h4 className="mb-1 text-base font-semibold leading-tight">
                                    {event.title}
                                  </h4>
                                  <div className="flex flex-wrap gap-1">
                                    {event.categories
                                      ?.slice(0, 2)
                                      .map((cat) => (
                                        <span
                                          key={cat}
                                          className="rounded-full bg-primary/10 px-2 py-0.5 text-xs capitalize text-primary"
                                        >
                                          {categoryLabelMap[cat] || cat}
                                        </span>
                                      ))}
                                  </div>
                                </div>

                                <div className="flex items-start gap-2 text-sm">
                                  <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                  <div>
                                    <div className="font-medium">
                                      {formatEventDate(
                                        event.startAt,
                                        event.timeZone,
                                        event.state,
                                        {
                                          weekday: "long",
                                          month: "long",
                                          day: "numeric",
                                        }
                                      )}
                                    </div>
                                    <div className="text-muted-foreground">
                                      {formatEventTime(
                                        event.startAt,
                                        event.timeZone,
                                        event.state
                                      )}
                                      {event.endAt &&
                                        ` - ${formatEventTime(
                                          event.endAt,
                                          event.timeZone,
                                          event.state
                                        )}`}
                                    </div>
                                  </div>
                                </div>

                                {event.venue?.name || event.city ? (
                                  <div className="flex items-start gap-2 text-sm">
                                    <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                    <div>
                                      {event.venue?.name ? (
                                        <div className="font-medium">
                                          {event.venue.name}
                                        </div>
                                      ) : null}
                                      <div className="text-muted-foreground">
                                        {event.city}, {event.state}
                                      </div>
                                    </div>
                                  </div>
                                ) : null}

                                {event.organizer ? (
                                  <div className="border-t pt-2 text-xs text-muted-foreground">
                                    Hosted by {event.organizer.name}
                                  </div>
                                ) : null}

                                <div className="pt-1 text-center text-xs text-muted-foreground">
                                  Click to view full details
                                </div>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        );
                      })}
                      {dayEvents.length > 3 ? (
                        <div className="text-xs text-muted-foreground">
                          +{dayEvents.length - 3} more
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    ) : undefined;

  return (
    <EventBrowserSurface
      rootClassName="min-h-screen"
      topSlot={<div ref={stickySentinelRef} className="h-px w-full" />}
      searchInputRef={browser.searchInputRef}
      searchQuery={browser.searchQuery}
      onSearchQueryChange={browser.setSearchQuery}
      onSearchFocus={() => browser.setIsSearchMode(true)}
      searchHref="/activity/search?filter=events"
      showSearchBack={isSearchView || isFilteredFeedView}
      onSearchBack={handleBackFromSearchOrFilter}
      shouldShowReturnToCurrentWeekButton={
        browser.shouldShowReturnToCurrentWeekButton
      }
      onToday={browser.handleToday}
      onPrevious={browser.handlePrevious}
      onNext={browser.handleNext}
      hideNavigationControls={isSearchView || isFilteredFeedView}
      cityValue={effectiveCity ?? "all"}
      onCityChange={browser.setSelectedCity}
      cityOptions={cityOptions}
      filterValue={activeFilter}
      onFilterChange={setActiveFilter}
      showSkeletons={showSkeletons}
      visibleCategories={visibleCategories}
      selectedCategories={browser.selectedCategories}
      onToggleCategory={browser.handleToggleCategory}
      topBanner={
        shouldShowAddFriendsBanner ? (
          <Card className="mb-4 rounded-[1.75rem] border-white/15 bg-white/[0.035]">
            <Link
              href="/activity"
              aria-label="Go to friends page"
              onClick={handleAddFriendsBannerClick}
              className="block"
            >
              <CardContent className="flex items-center justify-between gap-4 p-4 md:px-6 md:py-5">
                <div className="space-y-1">
                  <p className="text-xl font-semibold text-foreground">
                    WIG is better with friends.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Add your friends to see who is going out.
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-white" />
              </CardContent>
            </Link>
          </Card>
        ) : null
      }
      recentActivity={
        shouldShowRecentActivity
          ? {
              title: (
                <Link
                  href="/activity"
                  className="flex items-center gap-1 transition-colors hover:text-primary"
                >
                  <h1 className="text-lg font-bold tracking-tight">
                    Recent Activity
                  </h1>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ),
              content: <ActivityFeedList activities={homeActivityPreview} />,
            }
          : undefined
      }
      isSearchView={isSearchView}
      upcomingEventsLoading={upcomingSearchLoading}
      upcomingEvents={filteredUpcomingSearchEvents}
      filteredEvents={filteredEvents}
      flatListTitle={isFilteredFeedView ? "Upcoming Events" : null}
      emptyStates={{
        flatList: (
          <EventsPlaceholder
            message={
              isFollowingFeed
                ? "No upcoming events from places you're following"
                : undefined
            }
          />
        ),
        search: (
          <EmptyStateCard
            icon={CalendarIcon}
            title="No events found"
            description="Try adjusting your search or filters"
          />
        ),
        upcoming: (
          <EmptyStateCard
            icon={CalendarIcon}
            title={
              isFollowingFeed
                ? "No upcoming events from places you're following"
                : "No upcoming events to show"
            }
          />
        ),
        day: <EventsPlaceholder message="No events scheduled" />,
      }}
      daysToDisplay={daysToDisplay}
      isCurrentWeek={isCurrentWeek}
      eventsByDay={eventsByDay}
      showWeekSkeletons={shouldShowWeekSectionSkeletons}
      skeletonDateHeader={skeletonDateHeader}
      defaultContent={monthContent}
      afterFirstEventDay={
        shouldShowWhatsNew ? (
          <WhatsNewSection
            updates={visibleWhatsNewUpdates}
            hasFollowedPlaces={hasFollowedPlaces}
            selection={effectiveWhatsNewFilter}
            onSelectionChange={setSelectedWhatsNewFilter}
          />
        ) : undefined
      }
    />
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={<div className="container mx-auto min-h-screen py-8"></div>}
    >
      <HomePageContent />
    </Suspense>
  );
}
