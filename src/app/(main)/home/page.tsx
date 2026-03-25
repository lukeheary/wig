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
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  isBefore,
  isSameWeek,
  parseISO,
  subDays,
} from "date-fns";
import { useAuth } from "@clerk/nextjs";
import { useQueryState } from "nuqs";
import { CalendarIcon, Clock, ChevronRight, MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EventBrowserSurface } from "@/components/events/event-browser-surface";
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
import { cn, formatTime } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { type EventFilterTab } from "@/types/events";

type ViewMode = "week" | "month";
const HOME_ADD_FRIENDS_BANNER_KEY_PREFIX =
  "wig:home:add-friends-banner-dismissed";
const HOME_ACTIVITY_WINDOW_DAYS = 1;

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
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isAddFriendsBannerDismissed, setIsAddFriendsBannerDismissed] =
    useState(false);
  const [isSticky, setIsSticky] = useState(false);
  const [isDateNavigating, setIsDateNavigating] = useState(false);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const hasMarkedHomeActivitySeenRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useQueryState("search", {
    defaultValue: "",
    scroll: false,
    shallow: true,
  });
  const [selectedCity, setSelectedCity] = useQueryState<string | null>("city", {
    defaultValue: null,
    parse: (value) => value || null,
    serialize: (value) => value || "",
    scroll: false,
    shallow: true,
  });
  const [viewMode] = useQueryState<ViewMode>("view", {
    defaultValue: "week",
    parse: (value) => (value === "month" ? "month" : "week"),
    serialize: (value) => value,
    scroll: false,
    shallow: true,
  });
  const [dateParam, setDateParam] = useQueryState("date", {
    defaultValue: format(new Date(), "yyyy-MM-dd"),
    scroll: false,
    shallow: true,
  });

  const currentDate = useMemo(() => {
    try {
      return startOfDay(parseISO(dateParam));
    } catch {
      return startOfDay(new Date());
    }
  }, [dateParam]);

  const isCurrentWeek = useMemo(() => {
    if (viewMode !== "week") return false;
    const today = startOfDay(new Date());
    return (
      isSameWeek(currentDate, today, { weekStartsOn: 1 }) ||
      isBefore(currentDate, today)
    );
  }, [viewMode, currentDate]);

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
  const isSearching = Boolean(searchQuery && searchQuery.trim().length > 0);
  const isSearchView = isSearchMode || isSearching;
  const isDefaultCalendarView = activeFilter === "all";
  const isFollowingFeed = activeFilter === "following";
  const shouldPrioritizeFriendActivity =
    activeFilter === "all" || isFollowingFeed;
  const usesDaySectionLayout = isDefaultCalendarView || isFollowingFeed;
  const isFilteredFeedView = !isSearching && !usesDaySectionLayout;

  const handleExitSearch = useCallback(() => {
    setIsSearchMode(false);
    setSearchQuery("");
    searchInputRef.current?.blur();
  }, [setSearchQuery]);

  const handleBackFromSearchOrFilter = useCallback(() => {
    void triggerHaptic(HapticPreset.Soft);

    if (isFilteredFeedView) {
      setActiveFilter("all");
      return;
    }

    handleExitSearch();
  }, [handleExitSearch, isFilteredFeedView, triggerHaptic]);

  const scrollToSearchAndFocus = useCallback(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    registerScrollToSearch(scrollToSearchAndFocus);
  }, [registerScrollToSearch, scrollToSearchAndFocus]);

  useEffect(() => {
    setShowNavbarSearch(isSticky);
  }, [isSticky, setShowNavbarSearch]);

  const dateRange = useMemo(() => {
    const today = startOfDay(new Date());
    const isLastNightWindow = isCurrentWeek && new Date().getHours() < 6;

    if (isSearching || isFilteredFeedView) {
      return { startDate: today, endDate: addDays(today, 365) };
    }

    if (viewMode === "week") {
      if (isCurrentWeek) {
        const start = isLastNightWindow ? subDays(today, 1) : today;
        const end = endOfWeek(today, { weekStartsOn: 1 });
        return { startDate: start, endDate: end };
      }

      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const end = endOfWeek(start, { weekStartsOn: 1 });
      return { startDate: start, endDate: end };
    }

    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    return { startDate: start, endDate: end };
  }, [viewMode, currentDate, isCurrentWeek, isSearching, isFilteredFeedView]);

  const {
    data: events,
    isLoading,
    isFetching,
    error,
  } = trpc.event.listEventsByRange.useQuery(
    {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
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
        const friendActivityDifference =
          getFriendActivityCount(b) - getFriendActivityCount(a);

        if (friendActivityDifference !== 0) {
          return friendActivityDifference;
        }
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
    events,
    referenceCoords,
    shouldPrioritizeFriendActivity,
  ]);

  const sortedUpcomingSearchEvents = useMemo(() => {
    if (!upcomingSearchEvents) return [];
    if (!referenceCoords && !shouldPrioritizeFriendActivity) {
      return upcomingSearchEvents;
    }

    const nextEvents = [...upcomingSearchEvents];
    nextEvents.sort((a, b) => {
      if (shouldPrioritizeFriendActivity) {
        const friendActivityDifference =
          getFriendActivityCount(b) - getFriendActivityCount(a);

        if (friendActivityDifference !== 0) {
          return friendActivityDifference;
        }
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

  const visibleCategories = useMemo(() => {
    const availableCategoryKeys = new Set<string>();
    sortedEvents.forEach((event) =>
      event.categories?.forEach((key) => availableCategoryKeys.add(key))
    );

    return (activeCategories ?? []).filter((category) =>
      availableCategoryKeys.has(category.key)
    );
  }, [activeCategories, sortedEvents]);

  const filteredEvents = useMemo(() => {
    if (selectedCategories.length === 0) return sortedEvents;

    return sortedEvents.filter((event) =>
      selectedCategories.every((category) =>
        event.categories?.includes(category)
      )
    );
  }, [sortedEvents, selectedCategories]);

  const filteredUpcomingSearchEvents = useMemo(() => {
    if (selectedCategories.length === 0) return sortedUpcomingSearchEvents;

    return sortedUpcomingSearchEvents.filter((event) =>
      selectedCategories.every((category) =>
        event.categories?.includes(category)
      )
    );
  }, [sortedUpcomingSearchEvents, selectedCategories]);

  const eventsByDay = useMemo(
    () =>
      filteredEvents.reduce<Record<string, typeof filteredEvents>>(
        (groups, event) => {
          const dateKey = format(new Date(event.startAt), "yyyy-MM-dd");
          if (!groups[dateKey]) {
            groups[dateKey] = [];
          }
          groups[dateKey].push(event);
          return groups;
        },
        {}
      ),
    [filteredEvents]
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
    selectedCategories.length === 0;
  const hasAcceptedFriends = (acceptedFriends?.length ?? 0) > 0;
  const shouldShowAddFriendsBanner =
    !isSearchView &&
    !isSearching &&
    !showSkeletons &&
    isDefaultCalendarView &&
    !hasAcceptedFriends &&
    !isAddFriendsBannerDismissed;
  const shouldShowReturnToCurrentWeekButton =
    viewMode === "week" &&
    !isCurrentWeek &&
    !isSearchView &&
    !isFilteredFeedView;
  const shouldShowWeekSectionSkeletons =
    !isSearchView &&
    viewMode === "week" &&
    usesDaySectionLayout;
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

  const handleAddFriendsBannerClick = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(addFriendsBannerStorageKey, "true");
    }
    setIsAddFriendsBannerDismissed(true);
  }, [addFriendsBannerStorageKey]);

  const handlePrevious = useCallback(async () => {
    if (isCurrentWeek) {
      void triggerHaptic(HapticPreset.Warning);
      return;
    }

    void triggerHaptic(HapticPreset.Light);
    setIsDateNavigating(true);
    let nextDateParam: string;

    if (viewMode === "week") {
      const today = startOfDay(new Date());
      const prevWeekStart = addDays(currentDate, -7);

      if (
        isSameWeek(prevWeekStart, today, { weekStartsOn: 1 }) ||
        isBefore(prevWeekStart, today)
      ) {
        nextDateParam = format(today, "yyyy-MM-dd");
        await setDateParam(nextDateParam, {
          scroll: false,
          shallow: true,
        });
      } else {
        nextDateParam = format(
          startOfWeek(prevWeekStart, { weekStartsOn: 1 }),
          "yyyy-MM-dd"
        );
        await setDateParam(nextDateParam, { scroll: false, shallow: true });
      }
    } else {
      nextDateParam = format(subMonths(currentDate, 1), "yyyy-MM-dd");
      await setDateParam(nextDateParam, {
        scroll: false,
        shallow: true,
      });
    }

    sendGoogleAnalyticsEvent("home_date_navigation_clicked", userId, {
      direction: "previous",
      view_mode: viewMode,
      from_date: format(currentDate, "yyyy-MM-dd"),
      to_date: nextDateParam,
    });
  }, [
    currentDate,
    isCurrentWeek,
    setDateParam,
    triggerHaptic,
    userId,
    viewMode,
  ]);

  const handleNext = useCallback(async () => {
    void triggerHaptic(HapticPreset.Light);
    setIsDateNavigating(true);
    let nextDateParam: string;

    if (viewMode === "week") {
      const today = startOfDay(new Date());
      const nextDate = isCurrentWeek
        ? startOfWeek(addDays(today, 7), { weekStartsOn: 1 })
        : addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), 7);

      nextDateParam = format(nextDate, "yyyy-MM-dd");
      await setDateParam(nextDateParam, {
        scroll: false,
        shallow: true,
      });
    } else {
      nextDateParam = format(addMonths(currentDate, 1), "yyyy-MM-dd");
      await setDateParam(nextDateParam, {
        scroll: false,
        shallow: true,
      });
    }

    sendGoogleAnalyticsEvent("home_date_navigation_clicked", userId, {
      direction: "next",
      view_mode: viewMode,
      from_date: format(currentDate, "yyyy-MM-dd"),
      to_date: nextDateParam,
    });
  }, [
    currentDate,
    isCurrentWeek,
    setDateParam,
    triggerHaptic,
    userId,
    viewMode,
  ]);

  const handleToday = useCallback(async () => {
    void triggerHaptic(HapticPreset.Soft);
    setIsDateNavigating(true);
    await setDateParam(format(new Date(), "yyyy-MM-dd"), {
      scroll: false,
      shallow: true,
    });
  }, [setDateParam, triggerHaptic]);

  const daysToDisplay = useMemo(() => {
    if (viewMode === "week") {
      return eachDayOfInterval({
        start: dateRange.startDate,
        end: dateRange.endDate,
      });
    }

    return eachDayOfInterval({
      start: startOfMonth(currentDate),
      end: endOfMonth(currentDate),
    });
  }, [viewMode, currentDate, dateRange]);

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
    if (!isFetching) {
      setIsDateNavigating(false);
    }
  }, [isFetching]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSticky(!entry.isIntersecting);
      },
      {
        threshold: [1],
        rootMargin: "-1px 0px 0px 0px",
      }
    );

    const sentinel = stickySentinelRef.current;
    if (sentinel) {
      observer.observe(sentinel);
    }

    return () => {
      if (sentinel) {
        observer.unobserve(sentinel);
      }
    };
  }, []);

  const cityOptions = useMemo(
    () => [
      { value: "all", label: "All Cities" },
      ...(cities?.map((city) => ({
        value: city.city,
        label: `${city.city}, ${city.state}`,
      })) || []),
    ],
    [cities]
  );

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
                                      {format(
                                        new Date(event.startAt),
                                        "EEEE, MMMM d"
                                      )}
                                    </div>
                                    <div className="text-muted-foreground">
                                      {formatTime(event.startAt)}
                                      {event.endAt &&
                                        ` - ${formatTime(event.endAt)}`}
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
      searchInputRef={searchInputRef}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      onSearchFocus={() => setIsSearchMode(true)}
      showSearchBack={isSearchView || isFilteredFeedView}
      onSearchBack={handleBackFromSearchOrFilter}
      shouldShowReturnToCurrentWeekButton={shouldShowReturnToCurrentWeekButton}
      onToday={handleToday}
      onPrevious={handlePrevious}
      onNext={handleNext}
      isPreviousDisabled={isCurrentWeek}
      hideNavigationControls={isSearchView || isFilteredFeedView}
      cityValue={effectiveCity ?? "all"}
      onCityChange={setSelectedCity}
      cityOptions={cityOptions}
      filterValue={activeFilter}
      onFilterChange={setActiveFilter}
      showSkeletons={showSkeletons}
      visibleCategories={visibleCategories}
      selectedCategories={selectedCategories}
      onToggleCategory={(categoryKey) => {
        void triggerHaptic(HapticPreset.Selection);
        setSelectedCategories((current) =>
          current.includes(categoryKey)
            ? current.filter((key) => key !== categoryKey)
            : [...current, categoryKey]
        );
      }}
      topBanner={
        shouldShowAddFriendsBanner ? (
          <Card className="mb-4 bg-primary/5">
            <Link
              href="/friends"
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
      showRecentActivity={shouldShowRecentActivity}
      recentActivityTitle={
        <Link
          href="/friends"
          className="flex items-center gap-1 transition-colors hover:text-primary"
        >
          <h1 className="text-xl font-bold tracking-tight">Recent Activity</h1>
          <ChevronRight className="h-4 w-4" />
        </Link>
      }
      recentActivityContent={
        <ActivityFeedList activities={homeActivityPreview} />
      }
      isSearchView={isSearchView}
      isSearching={isSearching}
      upcomingEventsLoading={upcomingSearchLoading}
      upcomingEvents={filteredUpcomingSearchEvents}
      filteredEvents={filteredEvents}
      flatListTitle={isFilteredFeedView ? "Upcoming Events" : null}
      flatListEmptyState={
        <EventsPlaceholder
          message={
            isFollowingFeed
              ? "No upcoming events from places you're following"
              : undefined
          }
        />
      }
      searchEmptyState={
        <EmptyStateCard
          icon={CalendarIcon}
          title="No events found"
          description="Try adjusting your search or filters"
        />
      }
      upcomingEmptyState={
        <EmptyStateCard
          icon={CalendarIcon}
          title={
            isFollowingFeed
              ? "No upcoming events from places you're following"
              : "No upcoming events to show"
          }
        />
      }
      dayEmptyState={<EventsPlaceholder message="No events scheduled" />}
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
