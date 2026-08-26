"use client";

import {
  type ReactNode,
  type RefObject,
  Suspense,
  useEffect,
  useState,
} from "react";
import {
  differenceInCalendarWeeks,
  format,
  isSameDay,
  startOfDay,
  startOfWeek,
  subDays,
} from "date-fns";
import {
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";
import { MagnifyingGlass, SlidersHorizontal } from "@phosphor-icons/react";
import {
  HOME_MOBILE_EVENT_CARD_WIDTH,
  HomeMobileEventRail,
} from "@/components/events/home-mobile-event-rail";
import { EventFilterSelect } from "@/components/events/event-filter-select";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { ResponsiveSelect } from "@/components/ui/responsive-select";
import { StickySearchBar } from "@/components/ui/sticky-search-bar";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { type EventFilterTab } from "@/types/events";
import { type EventListItem } from "@/types/trpc";

const DESKTOP_RAIL_SIDE_INSET = "max(2rem, calc((100vw - 1200px) / 2 + 2rem))";

type CityOption = {
  value: string;
  label: string;
};

type CategoryOption = {
  id: string;
  key: string;
  label: string;
};

type EmptyStates = {
  flatList?: ReactNode;
  search?: ReactNode;
  upcoming?: ReactNode;
  day?: ReactNode;
};

type RecentActivity = {
  title?: ReactNode;
  content?: ReactNode;
};

interface EventBrowserSurfaceProps {
  rootClassName?: string;
  topSlot?: ReactNode;
  hideUntilScroll?: boolean;
  revealFrom?: "top" | "bottom";
  searchInputRef?: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void | Promise<unknown>;
  onSearchFocus?: () => void;
  showSearchBack?: boolean;
  onSearchBack: () => void;
  shouldShowReturnToCurrentWeekButton: boolean;
  onToday: () => void | Promise<unknown>;
  onPrevious: () => void | Promise<unknown>;
  onNext: () => void | Promise<unknown>;
  hideNavigationControls?: boolean;
  cityValue: string;
  onCityChange: (value: string) => void | Promise<unknown>;
  cityOptions: CityOption[];
  filterValue: EventFilterTab;
  onFilterChange: (value: EventFilterTab) => void;
  allowPersonalFilters?: boolean;
  showSkeletons: boolean;
  visibleCategories: CategoryOption[];
  selectedCategories: string[];
  onToggleCategory: (categoryKey: string) => void;
  topBanner?: ReactNode;
  recentActivity?: RecentActivity;
  isSearchView: boolean;
  upcomingEventsLoading: boolean;
  upcomingEvents: EventListItem[];
  filteredEvents: EventListItem[];
  flatListTitle?: string | null;
  emptyStates?: EmptyStates;
  daysToDisplay: Date[];
  isCurrentWeek: boolean;
  eventsByDay: Record<string, EventListItem[]>;
  showWeekSkeletons?: boolean;
  skeletonDateHeader?: string | null;
  defaultContent?: ReactNode;
}

const MOBILE_EVENT_FILTERS: Array<{ value: EventFilterTab; label: string }> = [
  { value: "all", label: "All Events" },
  { value: "following", label: "Following" },
  { value: "friends", label: "Friends' Events" },
  { value: "mine", label: "My Events" },
];

function MobileEventBrowserControls({
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchFocus,
  isSearchView,
  onSearchBack,
  filterValue,
  onFilterChange,
  allowPersonalFilters,
  visibleCategories,
  selectedCategories,
  onToggleCategory,
  daysToDisplay,
  isCurrentWeek,
  onToday,
  onPrevious,
  onNext,
}: Pick<
  EventBrowserSurfaceProps,
  | "searchInputRef"
  | "searchQuery"
  | "onSearchQueryChange"
  | "onSearchFocus"
  | "isSearchView"
  | "onSearchBack"
  | "filterValue"
  | "onFilterChange"
  | "allowPersonalFilters"
  | "visibleCategories"
  | "selectedCategories"
  | "onToggleCategory"
  | "daysToDisplay"
  | "isCurrentWeek"
  | "onToday"
  | "onPrevious"
  | "onNext"
>) {
  useEffect(() => {
    if (!isSearchView) return;
    const frame = window.requestAnimationFrame(() =>
      searchInputRef?.current?.focus()
    );
    return () => window.cancelAnimationFrame(frame);
  }, [isSearchView, searchInputRef]);

  if (isSearchView) {
    return (
      <>
        <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 md:hidden">
          <Suspense fallback={null}>
            <SearchInput
              ref={searchInputRef}
              placeholder="Search events..."
              value={searchQuery}
              onChange={onSearchQueryChange}
              showBack
              onBack={onSearchBack}
            />
          </Suspense>
        </div>
        <div
          className="h-[calc(3.75rem+env(safe-area-inset-top))] md:hidden"
          aria-hidden="true"
        />
      </>
    );
  }

  const firstDay = daysToDisplay[0];
  const lastDay = daysToDisplay[daysToDisplay.length - 1];
  const filterOptions = allowPersonalFilters
    ? MOBILE_EVENT_FILTERS
    : MOBILE_EVENT_FILTERS.slice(0, 1);
  const weeksAway = firstDay
    ? Math.max(
        0,
        differenceInCalendarWeeks(
          startOfWeek(firstDay, { weekStartsOn: 1 }),
          startOfWeek(new Date(), { weekStartsOn: 1 })
        )
      )
    : 0;
  const weekLabel =
    weeksAway === 0
      ? "This Week"
      : weeksAway === 1
        ? "Next Week"
        : `In ${weeksAway} Weeks`;

  return (
    <>
      <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 grid h-12 grid-cols-[5.75rem_minmax(0,1fr)_5.75rem] items-stretch gap-2 md:hidden">
        <div className="flex h-12 overflow-hidden rounded-3xl border border-white/15 bg-[#242426]/50 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-[24px]">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex flex-1 items-center justify-center"
                aria-label="Filter events"
              >
                <SlidersHorizontal className="h-[1.125rem] w-[1.125rem]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Events</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={filterValue}
                onValueChange={(value) =>
                  onFilterChange(value as EventFilterTab)
                }
              >
                {filterOptions.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {visibleCategories.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Categories</DropdownMenuLabel>
                  {visibleCategories.map((category) => (
                    <DropdownMenuCheckboxItem
                      key={category.id}
                      checked={selectedCategories.includes(category.key)}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={() => onToggleCategory(category.key)}
                    >
                      {category.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={onSearchFocus}
            className="flex flex-1 items-center justify-center"
            aria-label="Search events"
          >
            <MagnifyingGlass className="h-[1.125rem] w-[1.125rem]" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => !isCurrentWeek && void onToday()}
          className="flex h-12 min-w-0 flex-col items-center justify-center rounded-3xl border border-white/15 bg-[#242426]/50 px-2 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-[24px]"
        >
          <span className="text-[11px] font-semibold leading-none text-muted-foreground">
            {weekLabel}
          </span>
          <span className="mt-1 truncate text-xs font-semibold leading-none text-white">
            {firstDay && lastDay
              ? `${format(firstDay, "MMM d")} – ${format(lastDay, "MMM d")}`
              : ""}
          </span>
        </button>

        <div className="flex h-12 overflow-hidden rounded-3xl border border-white/15 bg-[#242426]/50 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-[24px]">
          <button
            type="button"
            onClick={() => void onPrevious()}
            disabled={isCurrentWeek}
            className="flex flex-1 items-center justify-center border-r border-white/10 disabled:opacity-35"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => void onNext()}
            className="flex flex-1 items-center justify-center"
            aria-label="Next week"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        className="h-[calc(3.75rem+env(safe-area-inset-top))] md:hidden"
        aria-hidden="true"
      />
    </>
  );
}

function getWeekSectionMeta(date: Date, isCurrentWeek: boolean) {
  const now = new Date();
  const isEarlyMorning = now.getHours() < 6;
  const yesterday = startOfDay(subDays(now, 1));
  const isToday = isSameDay(date, now);
  const isLastNightSection =
    isCurrentWeek && isEarlyMorning && isSameDay(date, yesterday);
  const isEvening = now.getHours() >= 17;

  const dateHeader = isLastNightSection
    ? "Last Night's Events"
    : isToday
      ? isEvening
        ? "Tonight"
        : "Today"
      : format(date, "EEE, MMM d");

  return {
    dateHeader,
    isToday,
    isLastNightSection,
  };
}

function StickyDateHeader({
  dateHeader,
  isToday,
  showBackToStart = false,
  onBackToStart,
}: {
  dateHeader: string;
  isToday: boolean;
  showBackToStart?: boolean;
  onBackToStart?: () => void;
}) {
  return (
    <StickySectionHeader stickyOnMobile={false}>
      <button
        type="button"
        onClick={showBackToStart ? onBackToStart : undefined}
        aria-label={
          showBackToStart
            ? `${dateHeader}: scroll events back to the beginning`
            : undefined
        }
        className={cn(
          "text-left",
          isToday && "text-primary",
          showBackToStart && "cursor-pointer"
        )}
      >
        {dateHeader}
      </button>
    </StickySectionHeader>
  );
}

function DayEventSection({
  dateHeader,
  isToday,
  dayEvents,
  emptyDayState,
}: {
  dateHeader: string;
  isToday: boolean;
  dayEvents: EventListItem[];
  emptyDayState?: ReactNode;
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
    <div>
      <StickyDateHeader
        dateHeader={dateHeader}
        isToday={isToday}
        showBackToStart={canScrollBack && !isResettingScroll}
        onBackToStart={() => {
          setIsResettingScroll(true);
          setScrollToStartSignal((current) => current + 1);
        }}
      />
      <div className="container mx-auto px-4">
        {dayEvents.length === 0 ? (
          (emptyDayState ?? (
            <EmptyStateCard icon={CalendarIcon} title="No events scheduled" />
          ))
        ) : (
          <HomeMobileEventRail
            events={dayEvents}
            desktopLayout="rail"
            desktopBleed
            onCanScrollBackChange={setCanScrollBack}
            scrollToStartSignal={scrollToStartSignal}
          />
        )}
      </div>
    </div>
  );
}

function EventSkeletonGrid({
  count = 8,
  mobileCount,
  desktopLayout = "grid",
  desktopBleed = false,
}: {
  count?: number;
  mobileCount?: number;
  desktopLayout?: "grid" | "rail";
  desktopBleed?: boolean;
}) {
  const renderedMobileCount = mobileCount ?? Math.max(6, count);
  const desktopSkeletonCards = Array.from({ length: count }).map((_, index) => (
    <div
      key={`event-skeleton-${index}`}
      className="w-[260px] shrink-0 self-stretch rounded-2xl bg-card p-2 shadow-sm"
    >
      <div className="flex h-full animate-pulse flex-col">
        <div className="aspect-square rounded-2xl bg-muted" />
        <div className="flex-1 space-y-2 px-3 py-3">
          <div className="h-4 w-3/4 rounded-full bg-muted" />
          <div className="h-3 w-1/2 rounded-full bg-muted" />
          <div className="h-3 w-2/3 rounded-full bg-muted" />
        </div>
      </div>
    </div>
  ));

  return (
    <>
      <div className="-mx-4 overflow-x-auto [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max items-stretch gap-3 px-4 pb-1">
          {Array.from({ length: renderedMobileCount }).map((_, index) => (
            <div
              key={`event-mobile-skeleton-${index}`}
              className="shrink-0 self-stretch rounded-2xl bg-card p-2 shadow-sm"
              style={{ width: `${HOME_MOBILE_EVENT_CARD_WIDTH}px` }}
            >
              <div className="animate-pulse">
                <div className="aspect-[0.98] rounded-2xl bg-muted" />
                <div className="space-y-2 px-1 pb-1 pt-3">
                  <div className="h-4 w-4/5 rounded-full bg-muted" />
                  <div className="h-3 w-3/5 rounded-full bg-muted" />
                  <div className="h-3 w-2/3 rounded-full bg-muted" />
                  <div className="h-6 w-16 rounded-full bg-muted" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {desktopLayout === "rail" ? (
        <div
          className="hidden md:block"
          style={
            desktopBleed
              ? {
                  width: "100vw",
                  marginLeft: `calc(-1 * ${DESKTOP_RAIL_SIDE_INSET})`,
                  maxWidth: "none",
                }
              : undefined
          }
        >
          <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div
              className={cn(
                "flex w-max items-stretch gap-4 pb-1",
                desktopBleed ? "pr-4 md:pr-6 lg:pr-8 xl:pr-10" : "px-0"
              )}
              style={
                desktopBleed
                  ? {
                      paddingLeft: DESKTOP_RAIL_SIDE_INSET,
                    }
                  : undefined
              }
            >
              {desktopSkeletonCards}
            </div>
          </div>
        </div>
      ) : (
        <div className="hidden grid-cols-1 gap-4 md:grid md:grid-cols-3 lg:grid-cols-4">
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
      )}
    </>
  );
}

export function EventBrowserSurface({
  rootClassName,
  topSlot,
  hideUntilScroll = false,
  revealFrom = "top",
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchFocus,
  isSearchView,
  showSearchBack = isSearchView,
  onSearchBack,
  shouldShowReturnToCurrentWeekButton,
  onToday,
  onPrevious,
  onNext,
  hideNavigationControls = false,
  cityValue,
  onCityChange,
  cityOptions,
  filterValue,
  onFilterChange,
  allowPersonalFilters = true,
  showSkeletons,
  visibleCategories,
  selectedCategories,
  onToggleCategory,
  topBanner,
  recentActivity,
  upcomingEventsLoading,
  upcomingEvents,
  filteredEvents,
  flatListTitle,
  emptyStates,
  daysToDisplay,
  isCurrentWeek,
  eventsByDay,
  showWeekSkeletons = true,
  skeletonDateHeader,
  defaultContent,
}: EventBrowserSurfaceProps) {
  const isSearching = Boolean(searchQuery.trim());
  const [hasScrolled, setHasScrolled] = useState(!hideUntilScroll);

  useEffect(() => {
    if (!hideUntilScroll) {
      setHasScrolled(true);
      return;
    }

    const handleScroll = () => {
      setHasScrolled(window.scrollY > 0);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [hideUntilScroll]);

  return (
    <div className={cn("relative pb-6", rootClassName)}>
      <div
        className={cn(
          "transition-all duration-700 ease-out",
          hasScrolled
            ? "opacity-100"
            : cn(
                "pointer-events-none opacity-0",
                revealFrom === "bottom" ? "translate-y-8" : "-translate-y-8"
              )
        )}
      >
        <div className="container relative mx-auto pt-4">
          {topSlot}

          <StickySearchBar innerClassName="w-full flex-col items-stretch sm:flex-col sm:items-stretch">
            <MobileEventBrowserControls
              searchInputRef={searchInputRef}
              searchQuery={searchQuery}
              onSearchQueryChange={onSearchQueryChange}
              onSearchFocus={onSearchFocus}
              isSearchView={isSearchView}
              onSearchBack={onSearchBack}
              filterValue={filterValue}
              onFilterChange={onFilterChange}
              allowPersonalFilters={allowPersonalFilters}
              visibleCategories={visibleCategories}
              selectedCategories={selectedCategories}
              onToggleCategory={onToggleCategory}
              daysToDisplay={daysToDisplay}
              isCurrentWeek={isCurrentWeek}
              onToday={onToday}
              onPrevious={onPrevious}
              onNext={onNext}
            />

            <div className="hidden w-full flex-col gap-2 md:flex md:flex-row md:items-center">
              <div className="flex w-full flex-row items-center">
                <div
                  className={cn(
                    "overflow-hidden transition-all duration-200 ease-out",
                    shouldShowReturnToCurrentWeekButton
                      ? "mr-2 w-12 opacity-100"
                      : "mr-0 w-0 opacity-0"
                  )}
                >
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void onToday();
                    }}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:outline-none"
                    tabIndex={shouldShowReturnToCurrentWeekButton ? 0 : -1}
                    aria-label="Back to current week"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                </div>

                <Suspense fallback={null}>
                  <SearchInput
                    ref={searchInputRef}
                    placeholder="Search events..."
                    value={searchQuery}
                    onChange={onSearchQueryChange}
                    onFocus={onSearchFocus}
                    showBack={showSearchBack}
                    onBack={onSearchBack}
                    className="min-w-0 flex-1"
                  />
                </Suspense>

                <div
                  className={cn(
                    "shrink-0 overflow-hidden transition-all duration-200 ease-out md:hidden",
                    showSearchBack || hideNavigationControls
                      ? "ml-0 w-0 opacity-0"
                      : "ml-2 opacity-100"
                  )}
                >
                  <div className="flex h-12 items-center overflow-hidden rounded-full border border-input bg-background shadow-sm">
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-full w-10 rounded-none border-r bg-muted px-0 active:bg-muted/80",
                        isCurrentWeek &&
                          "cursor-not-allowed opacity-50 hover:bg-muted"
                      )}
                      onClick={() => void onPrevious()}
                      aria-disabled={isCurrentWeek}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-full w-10 rounded-none bg-muted px-0 focus:bg-muted/80 active:bg-muted/80"
                      onClick={() => void onNext()}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex w-full gap-2 sm:w-fit">
                <ResponsiveSelect
                  value={cityValue}
                  onValueChange={onCityChange}
                  options={cityOptions}
                  placeholder="Select city"
                  title="Select City"
                  className="min-w-0 flex-1 sm:w-[180px] sm:flex-none"
                />

                <EventFilterSelect
                  value={filterValue}
                  onValueChange={onFilterChange}
                  allowPersonalFilters={allowPersonalFilters}
                  className="min-w-0 flex-1 sm:w-[180px] sm:flex-none"
                />

                <div
                  className={cn(
                    "hidden shrink-0 overflow-hidden transition-all duration-200 ease-out md:block",
                    showSearchBack || hideNavigationControls
                      ? "w-0 opacity-0"
                      : "w-[82px] opacity-100"
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
                      onClick={() => void onPrevious()}
                      aria-disabled={isCurrentWeek}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-full w-10 shrink-0 rounded-none bg-muted px-0 hover:bg-muted/80"
                      onClick={() => void onNext()}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {(showSkeletons || visibleCategories.length > 0) && (
              <div className="-mx-4 hidden overflow-x-auto pt-1 [scrollbar-width:none] md:-mx-8 md:block [&::-webkit-scrollbar]:hidden">
                <div className="flex gap-1.5 px-4 md:px-8">
                  {showSkeletons
                    ? [64, 80, 56, 72].map((width, index) => (
                        <div
                          key={`pill-skeleton-${index}`}
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
                            onClick={() => onToggleCategory(category.key)}
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                              isSelected
                                ? "bg-neon-teal text-background"
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
        </div>
      </div>

      {topBanner ? (
        <div className="container relative mx-auto">{topBanner}</div>
      ) : null}

      {recentActivity?.content ? (
        <div className="mb-4">
          <StickySectionHeader stickyOnMobile={false}>
            {recentActivity.title}
          </StickySectionHeader>
          <div className="container mx-auto px-4">{recentActivity.content}</div>
        </div>
      ) : null}

      {isSearchView && !isSearching ? (
        <div className="container mx-auto px-4">
          <div className="space-y-4">
            {upcomingEventsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : upcomingEvents.length === 0 ? (
              (emptyStates?.upcoming ?? (
                <EmptyStateCard
                  icon={CalendarIcon}
                  title="No upcoming events to show"
                />
              ))
            ) : (
              <HomeMobileEventRail
                events={upcomingEvents}
                mobileLayout="grid"
              />
            )}
          </div>
        </div>
      ) : null}

      {isSearching ? (
        <div className="container mx-auto px-4">
          <div className="space-y-4">
            {filteredEvents.length === 0 ? (
              (emptyStates?.search ?? (
                <EmptyStateCard
                  icon={CalendarIcon}
                  title="No events found"
                  description="Try adjusting your search or filters"
                />
              ))
            ) : (
              <HomeMobileEventRail
                events={filteredEvents}
                mobileLayout="grid"
              />
            )}
          </div>
        </div>
      ) : null}

      {showSkeletons ? (
        showWeekSkeletons ? (
          <div className="space-y-4">
            {daysToDisplay.map((date, index) => {
              const { dateHeader, isToday } = getWeekSectionMeta(
                date,
                isCurrentWeek
              );

              return (
                <div key={`skeleton-${format(date, "yyyy-MM-dd")}`}>
                  <StickyDateHeader dateHeader={dateHeader} isToday={isToday} />
                  <div className="container mx-auto px-4">
                    <EventSkeletonGrid
                      count={Math.min(4 + (index % 2), 5)}
                      mobileCount={3 + (index % 2)}
                      desktopLayout="rail"
                      desktopBleed
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            {skeletonDateHeader ? (
              <StickyDateHeader
                dateHeader={skeletonDateHeader}
                isToday={isCurrentWeek}
              />
            ) : null}
            <div className="container mx-auto px-4">
              <EventSkeletonGrid count={8} />
            </div>
          </div>
        )
      ) : null}

      {!showSkeletons && !isSearchView && flatListTitle ? (
        <div>
          <StickyDateHeader dateHeader={flatListTitle} isToday={false} />
          <div className="container mx-auto px-4">
            {filteredEvents.length === 0 ? (
              (emptyStates?.flatList ?? (
                <EmptyStateCard icon={CalendarIcon} title="No events found" />
              ))
            ) : (
              <HomeMobileEventRail
                events={filteredEvents}
                mobileLayout="grid"
              />
            )}
          </div>
        </div>
      ) : null}

      {!showSkeletons && !isSearchView && !flatListTitle
        ? (defaultContent ?? (
            <div className="space-y-5 md:space-y-4">
              {daysToDisplay.map((date) => {
                const dateKey = format(date, "yyyy-MM-dd");
                const dayEvents = eventsByDay[dateKey] || [];
                const { dateHeader, isToday, isLastNightSection } =
                  getWeekSectionMeta(date, isCurrentWeek);

                if (isLastNightSection && dayEvents.length === 0) {
                  return null;
                }

                return (
                  <div key={dateKey}>
                    <DayEventSection
                      dateHeader={dateHeader}
                      isToday={isToday}
                      dayEvents={dayEvents}
                      emptyDayState={emptyStates?.day}
                    />
                  </div>
                );
              })}
            </div>
          ))
        : null}
    </div>
  );
}
