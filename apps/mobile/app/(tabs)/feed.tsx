import { addDays, addWeeks, endOfWeek, isSameWeek, startOfDay, startOfWeek } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { HomeFeedSurface } from "../../components/home-feed-surface";
import { trpc } from "../../lib/trpc";
import type { AvailableCity, EventListItem } from "../../types/api";

type CategoryItem = {
  id: string;
  key: string;
  label: string;
};

export default function FeedScreen() {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const today = startOfDay(new Date());
  const isSearching = Boolean(searchQuery.trim());
  const isCurrentWeek = isSameWeek(weekStart, today, { weekStartsOn: 1 });

  const citiesQuery = trpc.event.getAvailableCities.useQuery();
  const categoriesQuery = trpc.category.listActive.useQuery();

  const eventsQuery = trpc.event.listPublicEventsByRange.useQuery({
    startDate: isSearching ? today : weekStart,
    endDate: isSearching
      ? addDays(today, 365)
      : endOfWeek(weekStart, { weekStartsOn: 1 }),
    limit: isSearching ? 120 : 80,
    city: selectedCity || undefined,
    search: searchQuery.trim() || undefined,
  });

  const visibleCategories = useMemo(() => {
    const availableKeys = new Set<string>();

    (eventsQuery.data ?? []).forEach((event: EventListItem) => {
      event.categories?.forEach((category) => availableKeys.add(category));
    });

    return (categoriesQuery.data ?? []).filter((category: CategoryItem) =>
      availableKeys.has(category.key)
    );
  }, [categoriesQuery.data, eventsQuery.data]);

  useEffect(() => {
    const visibleKeys = new Set(
      visibleCategories.map((category: CategoryItem) => category.key)
    );
    setSelectedCategories((current) =>
      current.filter((category) => visibleKeys.has(category))
    );
  }, [visibleCategories]);

  const filteredEvents = useMemo(() => {
    const events = eventsQuery.data ?? [];

    if (selectedCategories.length === 0) {
      return events;
    }

    return events.filter((event: EventListItem) =>
      selectedCategories.every((category) => event.categories?.includes(category))
    );
  }, [eventsQuery.data, selectedCategories]);

  return (
    <HomeFeedSurface
      weekStart={weekStart}
      isCurrentWeek={isCurrentWeek}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      onResetWeek={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
      onPreviousWeek={() => {
        if (isCurrentWeek) return;
        setWeekStart((current) => addWeeks(current, -1));
      }}
      onNextWeek={() => setWeekStart((current) => addWeeks(current, 1))}
      selectedCity={selectedCity}
      onSelectCity={setSelectedCity}
      cities={(citiesQuery.data ?? []) as AvailableCity[]}
      visibleCategories={visibleCategories}
      selectedCategories={selectedCategories}
      onToggleCategory={(key) =>
        setSelectedCategories((current) =>
          current.includes(key)
            ? current.filter((item) => item !== key)
            : [...current, key]
        )
      }
      events={filteredEvents as EventListItem[]}
      loading={eventsQuery.isLoading}
    />
  );
}
