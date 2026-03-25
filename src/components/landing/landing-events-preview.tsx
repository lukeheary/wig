"use client";

import { useMemo, useState } from "react";
import { addDays, startOfDay } from "date-fns";
import { EventBrowserSurface } from "@/components/events/event-browser-surface";
import { useEventBrowserState } from "@/components/events/use-event-browser-state";
import { LandingRecentActivity } from "@/components/landing/landing-recent-activity";
import { EventsPlaceholder } from "@/components/shared/events-placeholder";
import { trpc } from "@/lib/trpc";
import { type EventFilterTab } from "@/types/events";
import { type EventListItem } from "@/types/trpc";

const MOCK_EVENT_ATTENDEES = [
  { id: "landing-user-1", firstName: "Maya", lastName: null, avatarImageUrl: null },
  { id: "landing-user-2", firstName: "Theo", lastName: null, avatarImageUrl: null },
  { id: "landing-user-3", firstName: "Ari", lastName: null, avatarImageUrl: null },
  { id: "landing-user-4", firstName: "Lena", lastName: null, avatarImageUrl: null },
  { id: "landing-user-5", firstName: "Parker", lastName: null, avatarImageUrl: null },
  { id: "landing-user-6", firstName: "Zoe", lastName: null, avatarImageUrl: null },
  { id: "landing-user-7", firstName: "Kai", lastName: null, avatarImageUrl: null },
  { id: "landing-user-8", firstName: "Sofia", lastName: null, avatarImageUrl: null },
];

function withMockFriendsGoing(events: EventListItem[]): EventListItem[] {
  return events.map((event, index) => {
    const socialSeed = [...`${event.id}-${event.title}`].reduce(
      (total, char) => total + char.charCodeAt(0),
      index * 17
    );
    const socialPattern = socialSeed % 10;
    const attendeeCount =
      socialPattern < 4 ? 0 : socialPattern < 7 ? 1 : socialPattern < 9 ? 2 : 3;
    const startIndex = index % MOCK_EVENT_ATTENDEES.length;
    const friendsGoing = Array.from({ length: attendeeCount }, (_, offset) => ({
      status:
        offset === attendeeCount - 1 && attendeeCount > 1 ? "interested" : "going",
      user: MOCK_EVENT_ATTENDEES[(startIndex + offset) % MOCK_EVENT_ATTENDEES.length],
    })) as EventListItem["friendsGoing"];

    return {
      ...event,
      friendsGoing: friendsGoing.filter((rsvp) => rsvp.status === "going"),
      friendsInterested: friendsGoing.filter((rsvp) => rsvp.status === "interested"),
    };
  });
}

export function LandingEventsPreview() {
  const browser = useEventBrowserState();
  const [activeFilter, setActiveFilter] = useState<EventFilterTab>("all");

  const {
    data: events,
    isLoading,
    isFetching,
  } = trpc.event.listPublicEventsByRange.useQuery(
    {
      startDate: browser.dateRange.startDate,
      endDate: browser.dateRange.endDate,
      city:
        browser.selectedCity && browser.selectedCity !== "all"
          ? browser.selectedCity
          : undefined,
      search: browser.searchQuery || undefined,
      limit: browser.isSearching ? 100 : 64,
    },
    { placeholderData: (previousData) => previousData }
  );

  const { data: upcomingSearchEvents, isLoading: isUpcomingSearchLoading } =
    trpc.event.listPublicEventsByRange.useQuery(
      {
        startDate: startOfDay(new Date()),
        endDate: addDays(startOfDay(new Date()), 365),
        city:
          browser.selectedCity && browser.selectedCity !== "all"
            ? browser.selectedCity
            : undefined,
        limit: 20,
      },
      { enabled: browser.isSearchView && !browser.isSearching }
    );

  const enhancedEvents = useMemo(
    () => withMockFriendsGoing(events ?? []),
    [events]
  );
  const enhancedUpcomingEvents = useMemo(
    () => withMockFriendsGoing(upcomingSearchEvents ?? []),
    [upcomingSearchEvents]
  );

  const visibleCategories = useMemo(
    () => browser.getVisibleCategories(enhancedEvents),
    [browser, enhancedEvents]
  );
  const filteredEvents = useMemo(
    () => browser.filterByCategories(enhancedEvents),
    [browser, enhancedEvents]
  );
  const filteredUpcomingEvents = useMemo(
    () => browser.filterByCategories(enhancedUpcomingEvents),
    [browser, enhancedUpcomingEvents]
  );
  const eventsByDay = useMemo(
    () => browser.buildEventsByDay(filteredEvents),
    [browser, filteredEvents]
  );

  const showSkeletons = (!events && isLoading) || (isFetching && !browser.isSearching);
  const showRecentActivity =
    !browser.isSearchView &&
    !showSkeletons &&
    browser.isCurrentWeek &&
    activeFilter === "all" &&
    browser.selectedCategories.length === 0;

  return (
    <EventBrowserSurface
      searchInputRef={browser.searchInputRef}
      searchQuery={browser.searchQuery}
      onSearchQueryChange={browser.setSearchQuery}
      onSearchFocus={() => browser.setIsSearchMode(true)}
      onSearchBack={browser.handleExitSearch}
      shouldShowReturnToCurrentWeekButton={
        browser.shouldShowReturnToCurrentWeekButton
      }
      onToday={browser.handleToday}
      onPrevious={browser.handlePrevious}
      onNext={browser.handleNext}
      cityValue={browser.selectedCity ?? "all"}
      onCityChange={browser.setSelectedCity}
      cityOptions={browser.cityOptions}
      filterValue={activeFilter}
      onFilterChange={setActiveFilter}
      allowPersonalFilters={false}
      showSkeletons={showSkeletons}
      visibleCategories={visibleCategories}
      selectedCategories={browser.selectedCategories}
      onToggleCategory={browser.handleToggleCategory}
      recentActivity={
        showRecentActivity
          ? {
              title: (
                <h1 className="text-xl font-bold tracking-tight">
                  Recent Activity
                </h1>
              ),
              content: <LandingRecentActivity />,
            }
          : undefined
      }
      isSearchView={browser.isSearchView}
      upcomingEventsLoading={isUpcomingSearchLoading}
      upcomingEvents={filteredUpcomingEvents}
      filteredEvents={filteredEvents}
      emptyStates={{ day: <EventsPlaceholder message="No events scheduled" /> }}
      daysToDisplay={browser.daysToDisplay}
      isCurrentWeek={browser.isCurrentWeek}
      eventsByDay={eventsByDay}
    />
  );
}
