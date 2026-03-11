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
  nextSunday,
  getDay,
  startOfWeek,
  endOfWeek,
  isAfter,
  isBefore,
  startOfISOWeek,
  endOfISOWeek,
  isSameWeek,
} from "date-fns";
import { trpc } from "@/lib/trpc";
import { EventCardGrid } from "@/components/events/event-card-grid";
import {
  Loader2,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Clock,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SearchInput } from "@/components/ui/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn, formatTime } from "@/lib/utils";
import { EventFilterSelect } from "@/components/events/event-filter-select";
import { ResponsiveSelect } from "@/components/ui/responsive-select";
import { EventFilterTab } from "@/types/events";
import { useQueryState, parseAsString, parseAsIsoDate } from "nuqs";
import { parseISO, subDays } from "date-fns";
import {
  ActivityFeed,
  useHasRecentActivity,
} from "@/components/friends/activity-feed";
import { useNavbarSearch } from "@/contexts/nav-search-context";
import { getDistanceMiles, type Coordinates } from "@/lib/geo";
import { resolveMetroArea } from "@/lib/metro-areas";
import { StickySearchBar } from "@/components/ui/sticky-search-bar";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { withReturnTo } from "@/lib/navigation";
import { HapticPreset, useHaptics } from "@/hooks/use-haptics";
import { useAuth } from "@clerk/nextjs";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";

type ViewMode = "week" | "month";

function StickyDateHeader({
  dateHeader,
  isToday,
}: {
  dateHeader: string;
  isToday: boolean;
}) {
  return (
    <StickySectionHeader>
      <span className={cn("text-xl font-semibold", isToday && "text-primary")}>
        {dateHeader}
      </span>
    </StickySectionHeader>
  );
}

function EventSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={`event-skeleton-${index}`}
          className="rounded-2xl bg-card p-2 shadow-sm"
        >
          <div className="flex animate-pulse md:block">
            <div className="h-24 w-24 shrink-0 rounded-2xl bg-muted md:aspect-square md:h-auto md:w-full lg:max-w-[274px]" />
            <div className="flex-1 space-y-2 py-2 pl-3 pr-1 md:px-3 md:py-3">
              <div className="h-4 w-3/4 rounded-full bg-muted" />
              <div className="h-3 w-1/2 rounded-full bg-muted" />
              <div className="h-3 w-2/3 rounded-full bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function HomePageContent() {
  const { toast } = useToast();
  const { triggerHaptic } = useHaptics();
  const { userId } = useAuth();
  const [activeFilter, setActiveFilter] = useState<EventFilterTab>("all");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isSticky, setIsSticky] = useState(false);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
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
  const [viewMode, setViewMode] = useQueryState<ViewMode>("view", {
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
    } catch (e) {
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

  // Get current user to show their city
  const { data: currentUser, isLoading: isLoadingUser } =
    trpc.user.getCurrentUser.useQuery();

  // Check if there's recent activity to show
  const { hasActivity: hasRecentActivity } = useHasRecentActivity(3, true);

  // Get available cities
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

  // Navbar search context for navbar search button
  const { setShowNavbarSearch, registerScrollToSearch } = useNavbarSearch();

  // Determine the effective city: use URL param if set, otherwise resolve user's city to metro
  const effectiveCity = useMemo(() => {
    if (selectedCity) return selectedCity;
    if (!currentUser?.city) return null;
    if (!cities) return currentUser.city;
    // Resolve user's profile city (e.g. "Cambridge") to its metro area (e.g. "Boston")
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

  // Don't run queries until we know the user's city (to avoid flash of "all cities")
  const isReady = !isLoadingUser;

  // Determine if we're actively searching (has query text)
  const isSearching = Boolean(searchQuery && searchQuery.trim().length > 0);

  const handleExitSearch = () => {
    setIsSearchMode(false);
    setSearchQuery("");
    searchInputRef.current?.blur();
  };

  const toggleCategory = useCallback((categoryKey: string) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryKey)
        ? prev.filter((key) => key !== categoryKey)
        : [...prev, categoryKey]
    );
  }, []);

  // Scroll to search and focus callback for navbar search button
  const scrollToSearchAndFocus = useCallback(() => {
    // Jump to top instantly
    window.scrollTo(0, 0);
    // Focus the search input immediately
    searchInputRef.current?.focus();
  }, []);

  // Register the scroll callback with the context
  useEffect(() => {
    registerScrollToSearch(scrollToSearchAndFocus);
  }, [registerScrollToSearch, scrollToSearchAndFocus]);

  // Update navbar search visibility based on sticky state
  useEffect(() => {
    setShowNavbarSearch(isSticky);
  }, [isSticky, setShowNavbarSearch]);

  // Calculate date range based on view mode (or search mode)
  const dateRange = useMemo(() => {
    const today = startOfDay(new Date());
    const isLastNightWindow = isCurrentWeek && new Date().getHours() < 6;

    // When searching, search all future events (1 year ahead)
    if (isSearching) {
      return { startDate: today, endDate: addDays(today, 365) };
    }

    if (viewMode === "week") {
      if (isCurrentWeek) {
        // Current week: keep last night's events visible until 6am.
        const start = isLastNightWindow ? subDays(today, 1) : today;
        const end = endOfWeek(today, { weekStartsOn: 1 });
        return { startDate: start, endDate: end };
      } else {
        // Any other week: show full week from Monday to Sunday
        const start = startOfWeek(currentDate, { weekStartsOn: 1 });
        const end = endOfWeek(start, { weekStartsOn: 1 });
        return { startDate: start, endDate: end };
      }
    } else {
      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);
      return { startDate: start, endDate: end };
    }
  }, [viewMode, currentDate, isCurrentWeek, isSearching]);

  // Fetch events with current filters
  const {
    data: events,
    isLoading,
    isFetching,
    error,
  } = trpc.event.listEventsByRange.useQuery(
    {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      followedOnly: activeFilter === "followed",
      friendsGoingOnly: activeFilter === "friends",
      city:
        effectiveCity && effectiveCity !== "all" ? effectiveCity : undefined,
      search: searchQuery || undefined,
    },
    {
      placeholderData: (previousData) => previousData,
      enabled: isReady,
    }
  );

  const showSkeletons = !isReady || (isLoading && !events);

  // Fetch recently added events (for when search is focused but no query)
  const { data: recentEvents, isLoading: recentLoading } =
    trpc.event.getRecentlyAddedEvents.useQuery(
      {
        limit: 12,
        city:
          effectiveCity && effectiveCity !== "all" ? effectiveCity : undefined,
      },
      {
        enabled: isReady && isSearchMode && !isSearching,
      }
    );

  // Group events by day
  const sortedEvents = useMemo(() => {
    if (!events || !referenceCoords) return events ?? [];

    const nextEvents = [...events];
    nextEvents.sort((a, b) => {
      const aDistance =
        cityDistanceMap.get(`${a.city}|${a.state}`) ?? Number.POSITIVE_INFINITY;
      const bDistance =
        cityDistanceMap.get(`${b.city}|${b.state}`) ?? Number.POSITIVE_INFINITY;

      if (aDistance !== bDistance) return aDistance - bDistance;

      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    });

    return nextEvents;
  }, [events, referenceCoords, cityDistanceMap]);

  const sortedRecentEvents = useMemo(() => {
    if (!recentEvents || !referenceCoords) return recentEvents ?? [];

    const nextEvents = [...recentEvents];
    nextEvents.sort((a, b) => {
      const aDistance =
        cityDistanceMap.get(`${a.city}|${a.state}`) ?? Number.POSITIVE_INFINITY;
      const bDistance =
        cityDistanceMap.get(`${b.city}|${b.state}`) ?? Number.POSITIVE_INFINITY;

      if (aDistance !== bDistance) return aDistance - bDistance;

      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    });

    return nextEvents;
  }, [recentEvents, referenceCoords, cityDistanceMap]);

  // Only show categories that appear in the current event set
  const availableCategoryKeys = useMemo(() => {
    if (!sortedEvents.length) return new Set<string>();
    const keys = new Set<string>();
    sortedEvents.forEach((event) =>
      event.categories?.forEach((key) => keys.add(key))
    );
    return keys;
  }, [sortedEvents]);

  const visibleCategories = useMemo(
    () =>
      (activeCategories ?? []).filter((c) => availableCategoryKeys.has(c.key)),
    [activeCategories, availableCategoryKeys]
  );

  const filteredEvents = useMemo(() => {
    if (selectedCategories.length === 0) return sortedEvents;

    return sortedEvents.filter((event) =>
      selectedCategories.every((category) =>
        event.categories?.includes(category)
      )
    );
  }, [sortedEvents, selectedCategories]);

  const filteredRecentEvents = useMemo(() => {
    if (selectedCategories.length === 0) return sortedRecentEvents;

    return sortedRecentEvents.filter((event) =>
      selectedCategories.every((category) =>
        event.categories?.includes(category)
      )
    );
  }, [sortedRecentEvents, selectedCategories]);

  const eventsByDay = useMemo(() => {
    if (!filteredEvents.length) return {};

    const grouped: Record<string, typeof events> = {};

    filteredEvents.forEach((event) => {
      const dateKey = format(new Date(event.startAt), "yyyy-MM-dd");
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(event);
    });

    return grouped;
  }, [filteredEvents]);

  const handlePrevious = async () => {
    if (isCurrentWeek) {
      void triggerHaptic(HapticPreset.Warning);
      return;
    }

    void triggerHaptic(HapticPreset.Light);
    let nextDateParam: string;

    if (viewMode === "week") {
      const today = startOfDay(new Date());

      const prevWeekStart = addDays(currentDate, -7);
      // If going back takes us into the current week (or before it), jump to today
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
  };

  const handleNext = async () => {
    void triggerHaptic(HapticPreset.Light);
    let nextDateParam: string;

    if (viewMode === "week") {
      const today = startOfDay(new Date());
      let nextDate: Date;

      if (isCurrentWeek) {
        // From current week, go to next Monday
        nextDate = startOfWeek(addDays(today, 7), { weekStartsOn: 1 });
      } else {
        // From any other week, go to next Monday
        nextDate = addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), 7);
      }
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
  };

  const handleToday = async () => {
    await setDateParam(format(new Date(), "yyyy-MM-dd"), {
      scroll: false,
      shallow: true,
    });
  };

  // Get days to display based on view mode
  const daysToDisplay = useMemo(() => {
    if (viewMode === "week") {
      return eachDayOfInterval({
        start: dateRange.startDate,
        end: dateRange.endDate,
      });
    } else {
      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);
      return eachDayOfInterval({ start, end });
    }
  }, [viewMode, currentDate, dateRange]);

  // Show error toast in useEffect to avoid rendering issues
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
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSticky(!entry.isIntersecting);
      },
      {
        threshold: [1],
        // Root margin needs to account for the sticky offset (top-0 on mobile, top-16 on md)
        // But since we want to know when it hits the top, we can use a sentinel just above it.
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

  return (
    <div className="relative min-h-screen pb-12">
      <div className="container relative mx-auto pt-4">
        {/* Sentinel for sticky detection */}
        <div ref={stickySentinelRef} className="h-px w-full" />

        {/* Search and Filters */}
        <StickySearchBar innerClassName="w-full flex-col items-stretch sm:flex-col sm:items-stretch">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            {/* Search Input */}
            <div className="flex w-full flex-row">
              <Suspense fallback={null}>
                <SearchInput
                  ref={searchInputRef}
                  placeholder="Search events..."
                  value={searchQuery}
                  onChange={setSearchQuery}
                  onFocus={() => setIsSearchMode(true)}
                  showBack={isSearchMode}
                  onBack={handleExitSearch}
                  className="w-full"
                />
              </Suspense>
              <div
                className={cn(
                  "shrink-0 overflow-hidden transition-all duration-200 ease-out md:hidden",
                  isSearchMode ? "ml-0 w-0 opacity-0" : "ml-2 opacity-100"
                )}
              >
                <div className="flex h-12 items-center overflow-hidden rounded-full border border-input bg-background shadow-sm">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-full w-10 rounded-none border-r bg-muted px-0",
                      isCurrentWeek &&
                        "cursor-not-allowed opacity-50 hover:bg-muted"
                    )}
                    onClick={handlePrevious}
                    aria-disabled={isCurrentWeek}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-full w-10 rounded-none bg-muted px-0 focus:bg-muted/80"
                    onClick={handleNext}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex w-full gap-2 sm:w-fit">
              {/* City Filter */}
              <ResponsiveSelect
                value={effectiveCity ?? "all"}
                onValueChange={setSelectedCity}
                options={[
                  { value: "all", label: "All Cities" },
                  ...(cities?.map((city) => ({
                    value: city.city,
                    label: `${city.city}, ${city.state}`,
                  })) || []),
                ]}
                placeholder="Select city"
                title="Select City"
                className="min-w-0 flex-1 sm:w-[180px] sm:flex-none"
              />

              <EventFilterSelect
                value={activeFilter}
                onValueChange={setActiveFilter}
                className="min-w-0 flex-1 sm:w-[180px] sm:flex-none"
              />

              {/* Navigation Controls - fixed width wrapper for smooth transition */}
              <div
                className={cn(
                  "hidden shrink-0 overflow-hidden transition-all duration-200 ease-out md:block",
                  isSearchMode ? "w-0 opacity-0" : "w-[82px] opacity-100"
                )}
              >
                <div className="flex h-12 items-center overflow-hidden rounded-full border border-input bg-background shadow-sm">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-full w-10 shrink-0 rounded-none border-r bg-muted px-0 hover:bg-muted/60",
                      isCurrentWeek &&
                        "cursor-not-allowed opacity-50 hover:bg-muted"
                    )}
                    onClick={handlePrevious}
                    aria-disabled={isCurrentWeek}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-full w-10 shrink-0 rounded-none bg-muted px-0 hover:bg-muted/80"
                    onClick={handleNext}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {(showSkeletons || visibleCategories.length > 0) && (
            <div className="-mx-4 overflow-x-auto pt-1 [scrollbar-width:none] md:-mx-8 [&::-webkit-scrollbar]:hidden">
              <div className="flex gap-1.5 px-4 md:px-8">
                {showSkeletons
                  ? [64, 80, 56, 72].map((width, i) => (
                      <div
                        key={`pill-skeleton-${i}`}
                        className="h-7 animate-pulse rounded-full bg-muted/50"
                        style={{ width: `${width}px` }}
                      />
                    ))
                  : visibleCategories.map((category) => {
                      const isSelected = selectedCategories.includes(
                        category.key
                      );
                      return (
                        <button
                          key={category.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => {
                            void triggerHaptic(HapticPreset.Selection);
                            toggleCategory(category.key);
                          }}
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                            isSelected
                              ? "bg-foreground text-background"
                              : "bg-muted/50 text-muted-foreground md:hover:text-foreground"
                          )}
                        >
                          {category.label}
                          {isSelected && <X className="h-3 w-3" />}
                        </button>
                      );
                    })}
              </div>
            </div>
          )}
        </StickySearchBar>

        {/* Recently Added Events (when search focused but no query) */}
        {isSearchMode && !isSearching && !showSkeletons && (
          <div className="space-y-4">
            {/*<h2 className="text-lg font-semibold">Recently Added</h2>*/}
            {recentLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredRecentEvents.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                No recent events to show
              </div>
            ) : (
              <EventCardGrid
                events={filteredRecentEvents}
                columns={{ mobile: 1, tablet: 3, desktop: 4 }}
                gap="md"
              />
            )}
          </div>
        )}

        {/* Search Results - flat list, no date headers */}
        {isSearching && events && !showSkeletons && (
          <div className="space-y-4">
            {filteredEvents.length === 0 ? (
              <div className="py-12 text-center">
                <CalendarIcon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-semibold">No events found</h3>
                <p className="text-muted-foreground">
                  Try adjusting your search or filters
                </p>
              </div>
            ) : (
              <EventCardGrid
                events={filteredEvents}
                columns={{ mobile: 1, tablet: 3, desktop: 4 }}
                gap="md"
              />
            )}
          </div>
        )}
      </div>

      {/* Initial / Transition Loading State */}
      {showSkeletons && (
        <div>
          {!isSearchMode && (
            <StickyDateHeader
              dateHeader={
                new Date().getHours() >= 17
                  ? "Tonight's Events"
                  : "Today's Events"
              }
              isToday={true}
            />
          )}
          <div className="container mx-auto px-4">
            <EventSkeletonGrid count={8} />
          </div>
        </div>
      )}

      {/* Friend Activity Feed - only show if there's activity and not in search mode */}
      {!isSearchMode &&
        !showSkeletons &&
        hasRecentActivity &&
        isCurrentWeek && (
          <div className="mb-4">
            <StickySectionHeader>
              <Link
                href="/friends"
                className="flex items-center gap-1 transition-colors hover:text-primary"
              >
                <h1 className="text-xl font-bold tracking-tight">
                  Recent Activity
                </h1>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </StickySectionHeader>
            <div className="container mx-auto px-4">
              <ActivityFeed limit={3} hideWhenEmpty hidePastEvents />
            </div>
          </div>
        )}

      {/* Week View - outside container for full-width sticky headers */}
      {!isSearchMode && viewMode === "week" && events && !showSkeletons && (
        <div className="space-y-4">
          {daysToDisplay.map((date) => {
            const dateKey = format(date, "yyyy-MM-dd");
            const dayEvents = eventsByDay[dateKey] || [];
            const now = new Date();
            const isEarlyMorning = now.getHours() < 6;
            const yesterday = startOfDay(subDays(now, 1));
            const isToday = isSameDay(date, new Date());
            const isLastNightSection =
              isCurrentWeek && isEarlyMorning && isSameDay(date, yesterday);
            const currentHour = new Date().getHours();
            const isEvening = currentHour >= 17;

            if (isLastNightSection && dayEvents.length === 0) {
              return null;
            }

            const dateHeader = isLastNightSection
              ? "Last Night's Events"
              : isToday
                ? isEvening
                  ? "Tonight's Events"
                  : "Today's Events"
                : format(date, "EEE, MMM d");

            return (
              <div key={dateKey}>
                <StickyDateHeader dateHeader={dateHeader} isToday={isToday} />
                <div className="container mx-auto px-4">
                  {dayEvents.length === 0 ? (
                    <div className="flex min-h-[112px] items-center justify-center rounded-lg border border-dashed md:min-h-[300px]">
                      <p className="text-sm text-muted-foreground">
                        No events scheduled
                      </p>
                    </div>
                  ) : (
                    <EventCardGrid
                      events={dayEvents}
                      columns={{ mobile: 1, tablet: 3, desktop: 4 }}
                      gap="md"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="container mx-auto px-4">
        {/* Month View - only show when not in search mode */}
        {!isSearchMode && viewMode === "month" && events && !showSkeletons && (
          <Card>
            <CardContent className="p-4">
              {/* Day of week headers */}
              <div className="mb-2 grid grid-cols-7 gap-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (day) => (
                    <div
                      key={day}
                      className="py-2 text-center text-sm font-medium text-muted-foreground"
                    >
                      {day}
                    </div>
                  )
                )}
              </div>

              {/* Calendar grid */}
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
                                  {/* Event Image */}
                                  {eventImageUrl && (
                                    <div className="relative h-32 w-full overflow-hidden rounded-md">
                                      <Image
                                        src={eventImageUrl}
                                        alt={event.title}
                                        fill
                                        className="object-cover"
                                      />
                                    </div>
                                  )}

                                  {/* Title */}
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

                                  {/* Date & Time */}
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

                                  {/* Location */}
                                  {(event.venue?.name || event.city) && (
                                    <div className="flex items-start gap-2 text-sm">
                                      <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                      <div>
                                        {event.venue?.name && (
                                          <div className="font-medium">
                                            {event.venue.name}
                                          </div>
                                        )}
                                        <div className="text-muted-foreground">
                                          {event.city}, {event.state}
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {event.organizer && (
                                    <div className="border-t pt-2 text-xs text-muted-foreground">
                                      Hosted by {event.organizer.name}
                                    </div>
                                  )}

                                  {/* Click to view */}
                                  <div className="pt-1 text-center text-xs text-muted-foreground">
                                    Click to view full details
                                  </div>
                                </div>
                              </HoverCardContent>
                            </HoverCard>
                          );
                        })}
                        {dayEvents.length > 3 && (
                          <div className="text-xs text-muted-foreground">
                            +{dayEvents.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
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
