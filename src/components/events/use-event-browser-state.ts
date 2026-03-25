"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameWeek,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import { useQueryState } from "nuqs";
import { HapticPreset, useHaptics } from "@/hooks/use-haptics";
import { trpc } from "@/lib/trpc";
import { type EventListItem } from "@/types/trpc";

type ViewMode = "week" | "month";

type NavigateArgs = {
  direction: "previous" | "next" | "today";
  fromDate: string;
  toDate: string;
};

type UseEventBrowserStateOptions = {
  viewMode?: ViewMode;
  /** When true, the date range extends to a full-year flat list (home's filtered feed view) */
  isFilteredFeedView?: boolean;
  /** Called immediately when a navigation action starts, before the URL updates */
  onBeforeNavigate?: () => void;
  /** Called after the URL param has been set — useful for analytics */
  onNavigate?: (args: NavigateArgs) => void;
};

export function useEventBrowserState({
  viewMode = "week",
  isFilteredFeedView = false,
  onBeforeNavigate,
  onNavigate,
}: UseEventBrowserStateOptions = {}) {
  const { triggerHaptic } = useHaptics();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keep callback refs stable so navigation handlers don't need them in deps
  const onBeforeNavigateRef = useRef(onBeforeNavigate);
  onBeforeNavigateRef.current = onBeforeNavigate;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const [isSearchMode, setIsSearchMode] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

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
    if (viewMode !== "week") return false;
    const today = startOfDay(new Date());
    return (
      isSameWeek(currentDate, today, { weekStartsOn: 1 }) ||
      isBefore(currentDate, today)
    );
  }, [viewMode, currentDate]);

  const isSearching = Boolean(searchQuery.trim());
  const isSearchView = isSearchMode || isSearching;
  const shouldShowReturnToCurrentWeekButton =
    viewMode === "week" && !isCurrentWeek && !isSearchView && !isFilteredFeedView;

  const dateRange = useMemo(() => {
    const today = startOfDay(new Date());
    const isLastNightWindow = isCurrentWeek && new Date().getHours() < 6;

    if (isSearching || isFilteredFeedView) {
      return { startDate: today, endDate: addDays(today, 365) };
    }

    if (viewMode === "week") {
      if (isCurrentWeek) {
        return {
          startDate: isLastNightWindow ? subDays(today, 1) : today,
          endDate: endOfWeek(today, { weekStartsOn: 1 }),
        };
      }
      const startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
      return { startDate, endDate: endOfWeek(startDate, { weekStartsOn: 1 }) };
    }

    // month view
    const start = startOfMonth(currentDate);
    return { startDate: start, endDate: endOfMonth(currentDate) };
  }, [viewMode, currentDate, isCurrentWeek, isSearching, isFilteredFeedView]);

  const daysToDisplay = useMemo(() => {
    if (viewMode === "month") {
      return eachDayOfInterval({
        start: startOfMonth(currentDate),
        end: endOfMonth(currentDate),
      });
    }
    return eachDayOfInterval({
      start: dateRange.startDate,
      end: dateRange.endDate,
    });
  }, [viewMode, currentDate, dateRange]);

  const { data: cities } = trpc.event.getAvailableCities.useQuery();
  const { data: activeCategories } = trpc.category.listActive.useQuery();

  const cityOptions = useMemo(
    () => [
      { value: "all", label: "All Cities" },
      ...(cities?.map((city) => ({
        value: city.city,
        label: `${city.city}, ${city.state}`,
      })) ?? []),
    ],
    [cities]
  );

  const getVisibleCategories = useCallback(
    (events: EventListItem[]) => {
      const availableCategoryKeys = new Set<string>();
      events.forEach((event) =>
        event.categories?.forEach((key) => availableCategoryKeys.add(key))
      );
      return (activeCategories ?? []).filter((cat) =>
        availableCategoryKeys.has(cat.key)
      );
    },
    [activeCategories]
  );

  const filterByCategories = useCallback(
    (events: EventListItem[]) => {
      if (selectedCategories.length === 0) return events;
      return events.filter((event) =>
        selectedCategories.every((cat) => event.categories?.includes(cat))
      );
    },
    [selectedCategories]
  );

  const buildEventsByDay = useCallback((events: EventListItem[]) => {
    return events.reduce<Record<string, EventListItem[]>>((groups, event) => {
      const dateKey = format(new Date(event.startAt), "yyyy-MM-dd");
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(event);
      return groups;
    }, {});
  }, []);

  const handleExitSearch = useCallback(() => {
    void triggerHaptic(HapticPreset.Soft);
    setIsSearchMode(false);
    void setSearchQuery("");
    searchInputRef.current?.blur();
  }, [setSearchQuery, triggerHaptic]);

  const handleToday = useCallback(async () => {
    const fromDate = dateParam;
    const toDate = format(new Date(), "yyyy-MM-dd");
    onBeforeNavigateRef.current?.();
    void triggerHaptic(HapticPreset.Soft);
    await setDateParam(toDate, { scroll: false, shallow: true });
    onNavigateRef.current?.({ direction: "today", fromDate, toDate });
  }, [dateParam, setDateParam, triggerHaptic]);

  const handlePrevious = useCallback(async () => {
    if (isCurrentWeek) {
      void triggerHaptic(HapticPreset.Warning);
      return;
    }
    const fromDate = dateParam;
    onBeforeNavigateRef.current?.();
    void triggerHaptic(HapticPreset.Light);

    let toDate: string;
    if (viewMode === "month") {
      toDate = format(subMonths(currentDate, 1), "yyyy-MM-dd");
    } else {
      const today = startOfDay(new Date());
      const prevWeekStart = addDays(currentDate, -7);
      if (
        isSameWeek(prevWeekStart, today, { weekStartsOn: 1 }) ||
        isBefore(prevWeekStart, today)
      ) {
        toDate = format(today, "yyyy-MM-dd");
      } else {
        toDate = format(
          startOfWeek(prevWeekStart, { weekStartsOn: 1 }),
          "yyyy-MM-dd"
        );
      }
    }

    await setDateParam(toDate, { scroll: false, shallow: true });
    onNavigateRef.current?.({ direction: "previous", fromDate, toDate });
  }, [currentDate, dateParam, isCurrentWeek, setDateParam, triggerHaptic, viewMode]);

  const handleNext = useCallback(async () => {
    const fromDate = dateParam;
    onBeforeNavigateRef.current?.();
    void triggerHaptic(HapticPreset.Light);

    let toDate: string;
    if (viewMode === "month") {
      toDate = format(addMonths(currentDate, 1), "yyyy-MM-dd");
    } else {
      const today = startOfDay(new Date());
      const nextDate = isCurrentWeek
        ? startOfWeek(addDays(today, 7), { weekStartsOn: 1 })
        : addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), 7);
      toDate = format(nextDate, "yyyy-MM-dd");
    }

    await setDateParam(toDate, { scroll: false, shallow: true });
    onNavigateRef.current?.({ direction: "next", fromDate, toDate });
  }, [currentDate, dateParam, isCurrentWeek, setDateParam, triggerHaptic, viewMode]);

  const handleToggleCategory = useCallback(
    (categoryKey: string) => {
      void triggerHaptic(HapticPreset.Selection);
      setSelectedCategories((current) =>
        current.includes(categoryKey)
          ? current.filter((key) => key !== categoryKey)
          : [...current, categoryKey]
      );
    },
    [triggerHaptic]
  );

  return {
    // Raw state (for data fetching)
    searchQuery,
    setSearchQuery,
    selectedCity,
    setSelectedCity,
    isSearching,
    isSearchView,
    isCurrentWeek,
    currentDate,
    dateRange,
    daysToDisplay,
    selectedCategories,

    // Derived data
    cityOptions,
    activeCategories,
    getVisibleCategories,
    filterByCategories,
    buildEventsByDay,

    // Refs
    searchInputRef,

    // Handlers
    setIsSearchMode,
    handleExitSearch,
    handleToday,
    handlePrevious,
    handleNext,
    handleToggleCategory,

    // Surface-ready computed
    shouldShowReturnToCurrentWeekButton,
  };
}
