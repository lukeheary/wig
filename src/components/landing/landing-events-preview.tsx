"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  addDays,
  eachDayOfInterval,
  endOfWeek,
  format,
  isBefore,
  isSameWeek,
  parseISO,
  startOfDay,
  startOfWeek,
  subDays,
} from "date-fns";
import { useQueryState } from "nuqs";
import { EventBrowserSurface } from "@/components/events/event-browser-surface";
import { LandingRecentActivity } from "@/components/landing/landing-recent-activity";
import { EventsPlaceholder } from "@/components/shared/events-placeholder";
import { HapticPreset, useHaptics } from "@/hooks/use-haptics";
import { trpc } from "@/lib/trpc";
import { type EventFilterTab } from "@/types/events";
import { type EventListItem } from "@/types/trpc";

const MOCK_EVENT_ATTENDEES = [
  {
    id: "landing-user-1",
    firstName: "Maya",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-2",
    firstName: "Theo",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-3",
    firstName: "Ari",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-4",
    firstName: "Lena",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-5",
    firstName: "Parker",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-6",
    firstName: "Zoe",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-7",
    firstName: "Kai",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-8",
    firstName: "Sofia",
    lastName: null,
    avatarImageUrl: null,
  },
];

function withMockFriendsGoing(events: EventListItem[]): EventListItem[] {
  return events.map((event, index) => {
    const socialSeed = [...`${event.id}-${event.title}`].reduce(
      (total, char) => total + char.charCodeAt(0),
      index * 17
    );
    const socialPattern = socialSeed % 10;
    const attendeeCount =
      socialPattern < 4
        ? 0
        : socialPattern < 7
          ? 1
          : socialPattern < 9
            ? 2
            : 3;
    const startIndex = index % MOCK_EVENT_ATTENDEES.length;
    const friendsGoing = Array.from({ length: attendeeCount }, (_, offset) => ({
      status:
        offset === attendeeCount - 1 && attendeeCount > 1
          ? "interested"
          : "going",
      user: MOCK_EVENT_ATTENDEES[
        (startIndex + offset) % MOCK_EVENT_ATTENDEES.length
      ],
    })) as EventListItem["friendsGoing"];

    return {
      ...event,
      friendsGoing: friendsGoing.filter((rsvp) => rsvp.status === "going"),
      friendsInterested: friendsGoing.filter(
        (rsvp) => rsvp.status === "interested"
      ),
    };
  });
}

export function LandingEventsPreview() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { triggerHaptic } = useHaptics();
  const [activeFilter, setActiveFilter] = useState<EventFilterTab>("all");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
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
    const today = startOfDay(new Date());
    return (
      isSameWeek(currentDate, today, { weekStartsOn: 1 }) ||
      isBefore(currentDate, today)
    );
  }, [currentDate]);

  const isSearching = Boolean(searchQuery.trim());
  const isSearchView = isSearchMode || isSearching;
  const shouldShowReturnToCurrentWeekButton = !isCurrentWeek && !isSearchView;

  const dateRange = useMemo(() => {
    const today = startOfDay(new Date());
    const isLastNightWindow = isCurrentWeek && new Date().getHours() < 6;

    if (isSearching) {
      return { startDate: today, endDate: addDays(today, 365) };
    }

    if (isCurrentWeek) {
      return {
        startDate: isLastNightWindow ? subDays(today, 1) : today,
        endDate: endOfWeek(today, { weekStartsOn: 1 }),
      };
    }

    const startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
    return {
      startDate,
      endDate: endOfWeek(startDate, { weekStartsOn: 1 }),
    };
  }, [currentDate, isCurrentWeek, isSearching]);

  const { data: cities } = trpc.event.getAvailableCities.useQuery();
  const { data: activeCategories } = trpc.category.listActive.useQuery();
  const {
    data: events,
    isLoading,
    isFetching,
  } = trpc.event.listPublicEventsByRange.useQuery(
    {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      city: selectedCity && selectedCity !== "all" ? selectedCity : undefined,
      search: searchQuery || undefined,
      limit: isSearching ? 100 : 64,
    },
    {
      placeholderData: (previousData) => previousData,
    }
  );

  const { data: upcomingSearchEvents, isLoading: isUpcomingSearchLoading } =
    trpc.event.listPublicEventsByRange.useQuery(
      {
        startDate: startOfDay(new Date()),
        endDate: addDays(startOfDay(new Date()), 365),
        city: selectedCity && selectedCity !== "all" ? selectedCity : undefined,
        limit: 20,
      },
      {
        enabled: isSearchView && !isSearching,
      }
    );

  const enhancedEvents = useMemo(
    () => withMockFriendsGoing(events ?? []),
    [events]
  );
  const enhancedUpcomingEvents = useMemo(
    () => withMockFriendsGoing(upcomingSearchEvents ?? []),
    [upcomingSearchEvents]
  );

  const visibleCategories = useMemo(() => {
    const availableCategoryKeys = new Set<string>();
    enhancedEvents.forEach((event) =>
      event.categories?.forEach((category) =>
        availableCategoryKeys.add(category)
      )
    );

    return (activeCategories ?? []).filter((category) =>
      availableCategoryKeys.has(category.key)
    );
  }, [activeCategories, enhancedEvents]);

  const filteredEvents = useMemo(() => {
    if (selectedCategories.length === 0) return enhancedEvents;

    return enhancedEvents.filter((event) =>
      selectedCategories.every((category) =>
        event.categories?.includes(category)
      )
    );
  }, [enhancedEvents, selectedCategories]);

  const filteredUpcomingEvents = useMemo(() => {
    if (selectedCategories.length === 0) return enhancedUpcomingEvents;

    return enhancedUpcomingEvents.filter((event) =>
      selectedCategories.every((category) =>
        event.categories?.includes(category)
      )
    );
  }, [enhancedUpcomingEvents, selectedCategories]);

  const eventsByDay = useMemo(
    () =>
      filteredEvents.reduce<Record<string, EventListItem[]>>(
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

  const daysToDisplay = useMemo(
    () =>
      eachDayOfInterval({
        start: dateRange.startDate,
        end: dateRange.endDate,
      }),
    [dateRange]
  );

  const showSkeletons = (!events && isLoading) || (isFetching && !isSearching);

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

  const handleSearchBack = useCallback(() => {
    void triggerHaptic(HapticPreset.Soft);
    setIsSearchMode(false);
    void setSearchQuery("");
    searchInputRef.current?.blur();
  }, [setSearchQuery, triggerHaptic]);

  const handleToday = useCallback(() => {
    void triggerHaptic(HapticPreset.Soft);
    return setDateParam(format(new Date(), "yyyy-MM-dd"), {
      scroll: false,
      shallow: true,
    });
  }, [setDateParam, triggerHaptic]);

  const handlePrevious = useCallback(async () => {
    if (isCurrentWeek) {
      void triggerHaptic(HapticPreset.Warning);
      return;
    }

    void triggerHaptic(HapticPreset.Light);

    const today = startOfDay(new Date());
    const previousWeekStart = addDays(currentDate, -7);

    if (
      isSameWeek(previousWeekStart, today, { weekStartsOn: 1 }) ||
      isBefore(previousWeekStart, today)
    ) {
      await setDateParam(format(today, "yyyy-MM-dd"), {
        scroll: false,
        shallow: true,
      });
      return;
    }

    await setDateParam(
      format(startOfWeek(previousWeekStart, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      {
        scroll: false,
        shallow: true,
      }
    );
  }, [currentDate, isCurrentWeek, setDateParam, triggerHaptic]);

  const handleNext = useCallback(() => {
    void triggerHaptic(HapticPreset.Light);

    const today = startOfDay(new Date());
    const nextDate = isCurrentWeek
      ? startOfWeek(addDays(today, 7), { weekStartsOn: 1 })
      : addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), 7);

    return setDateParam(format(nextDate, "yyyy-MM-dd"), {
      scroll: false,
      shallow: true,
    });
  }, [currentDate, isCurrentWeek, setDateParam, triggerHaptic]);

  return (
    <EventBrowserSurface
      searchInputRef={searchInputRef}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      onSearchFocus={() => setIsSearchMode(true)}
      showSearchBack={isSearchView}
      onSearchBack={handleSearchBack}
      shouldShowReturnToCurrentWeekButton={shouldShowReturnToCurrentWeekButton}
      onToday={handleToday}
      onPrevious={handlePrevious}
      onNext={handleNext}
      isPreviousDisabled={isCurrentWeek}
      cityValue={selectedCity ?? "all"}
      onCityChange={setSelectedCity}
      cityOptions={cityOptions}
      filterValue={activeFilter}
      onFilterChange={setActiveFilter}
      allowPersonalFilters={false}
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
      showRecentActivity={
        !isSearchView &&
        !showSkeletons &&
        isCurrentWeek &&
        activeFilter === "all" &&
        selectedCategories.length === 0
      }
      recentActivityTitle={
        <h1 className="text-xl font-bold tracking-tight">Recent Activity</h1>
      }
      recentActivityContent={<LandingRecentActivity />}
      isSearchView={isSearchView}
      isSearching={isSearching}
      upcomingEventsLoading={isUpcomingSearchLoading}
      upcomingEvents={filteredUpcomingEvents}
      filteredEvents={filteredEvents}
      dayEmptyState={<EventsPlaceholder message="No events scheduled" />}
      daysToDisplay={daysToDisplay}
      isCurrentWeek={isCurrentWeek}
      eventsByDay={eventsByDay}
    />
  );
}
