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
import {
  format,
  addDays,
  startOfDay,
  isSameMonth,
  isSameDay,
} from "date-fns";
import { useAuth } from "@clerk/nextjs";
import { useQueryState } from "nuqs";
import { CalendarIcon, Clock, ChevronRight, MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EventBrowserSurface } from "@/components/events/event-browser-surface";
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
import { getDistanceMiles, type Coordinates } from "@/lib/geo";
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

function getFriendActivityCount(event: {
  friendsGoing?: ArrayLike<unknown> | null;
  friendsInterested?: ArrayLike<unknown> | null;
}) {
  return (
    (event.friendsGoing?.length ?? 0) + (event.friendsInterested?.length ?? 0)
  );
}

function HomePageContent() {
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
  const shouldPrioritizeFriendActivity =
    activeFilter === "all" || isFollowingFeed;

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

  const referenceCity =
    selectedCity && selectedCity !== "all"
      ? selectedCity
      : (effectiveCity ?? null);

  const referenceCityRecord = useMemo(() => {
    if (!referenceCity || !cities) return null;
    const matches = cities.filter((city) => city.city === referenceCity);
    if (matches.length === 0) return null;
    if (currentUser?.state) {
      const preferred = matches.find(
        (city) => city.state === currentUser.state
      );
      if (preferred) return preferred;
    }
    return matches[0];
  }, [referenceCity, cities, currentUser?.state]);

  const referenceCoords = useMemo<Coordinates | null>(() => {
    if (
      referenceCityRecord?.latitude == null ||
      referenceCityRecord?.longitude == null
    ) {
      return null;
    }
    return {
      latitude: referenceCityRecord.latitude,
      longitude: referenceCityRecord.longitude,
    };
  }, [referenceCityRecord]);

  const cityDistanceMap = useMemo(() => {
    if (!cities || !referenceCoords) return new Map<string, number>();
    const map = new Map<string, number>();
    cities.forEach((city) => {
      if (city.latitude == null || city.longitude == null) return;
      const distance = getDistanceMiles(referenceCoords, {
        latitude: city.latitude,
        longitude: city.longitude,
      });
      if (distance != null) {
        map.set(`${city.city}|${city.state}`, distance);
      }
    });
    return map;
  }, [cities, referenceCoords]);

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
    if (!referenceCoords && !shouldPrioritizeFriendActivity) return events;
    const nextEvents = [...events];
    nextEvents.sort((a, b) => {
      if (shouldPrioritizeFriendActivity) {
        const diff = getFriendActivityCount(b) - getFriendActivityCount(a);
        if (diff !== 0) return diff;
      }
      if (!referenceCoords) {
        return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
      }
      const aDistance =
        cityDistanceMap.get(`${a.city}|${a.state}`) ?? Number.POSITIVE_INFINITY;
      const bDistance =
        cityDistanceMap.get(`${b.city}|${b.state}`) ?? Number.POSITIVE_INFINITY;
      if (aDistance !== bDistance) return aDistance - bDistance;
      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    });
    return nextEvents;
  }, [cityDistanceMap, events, referenceCoords, shouldPrioritizeFriendActivity]);

  const sortedUpcomingSearchEvents = useMemo(() => {
    if (!upcomingSearchEvents) return [];
    if (!referenceCoords && !shouldPrioritizeFriendActivity)
      return upcomingSearchEvents;
    const nextEvents = [...upcomingSearchEvents];
    nextEvents.sort((a, b) => {
      if (shouldPrioritizeFriendActivity) {
        const diff = getFriendActivityCount(b) - getFriendActivityCount(a);
        if (diff !== 0) return diff;
      }
      if (!referenceCoords) {
        return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
      }
      const aDistance =
        cityDistanceMap.get(`${a.city}|${a.state}`) ?? Number.POSITIVE_INFINITY;
      const bDistance =
        cityDistanceMap.get(`${b.city}|${b.state}`) ?? Number.POSITIVE_INFINITY;
      if (aDistance !== bDistance) return aDistance - bDistance;
      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    });
    return nextEvents;
  }, [
    cityDistanceMap,
    referenceCoords,
    shouldPrioritizeFriendActivity,
    upcomingSearchEvents,
  ]);

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
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    browser.searchInputRef.current?.focus();
  }, [browser.searchInputRef]);

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
                                    `/event/${event.id}`,
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
          <Card className="mb-4 bg-primary/5">
            <Link
              href="/activity"
              aria-label="Go to friends page"
              onClick={handleAddFriendsBannerClick}
              className="block"
            >
              <CardContent className="flex items-center justify-between gap-4 p-4">
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
                  <h1 className="text-xl font-bold tracking-tight">
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
