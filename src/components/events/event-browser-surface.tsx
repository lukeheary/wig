"use client";

import {
  type ReactNode,
  type RefObject,
  Suspense,
  useEffect,
  useState,
} from "react";
import { format, isSameDay, startOfDay, subDays } from "date-fns";
import {
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { type EventFilterTab } from "@/types/events";
import { type EventListItem } from "@/types/trpc";

type CityOption = {
  value: string;
  label: string;
};

type CategoryOption = {
  id: string;
  key: string;
  label: string;
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
  showSearchBack: boolean;
  onSearchBack: () => void;
  shouldShowReturnToCurrentWeekButton: boolean;
  onToday: () => void | Promise<unknown>;
  onPrevious: () => void | Promise<unknown>;
  onNext: () => void | Promise<unknown>;
  isPreviousDisabled: boolean;
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
  showRecentActivity?: boolean;
  recentActivityTitle?: ReactNode;
  recentActivityContent?: ReactNode;
  isSearchView: boolean;
  isSearching: boolean;
  upcomingEventsLoading: boolean;
  upcomingEvents: EventListItem[];
  filteredEvents: EventListItem[];
  flatListTitle?: string | null;
  flatListEmptyState?: ReactNode;
  searchEmptyState?: ReactNode;
  upcomingEmptyState?: ReactNode;
  dayEmptyState?: ReactNode;
  daysToDisplay: Date[];
  isCurrentWeek: boolean;
  eventsByDay: Record<string, EventListItem[]>;
  showWeekSkeletons?: boolean;
  skeletonDateHeader?: string | null;
  defaultContent?: ReactNode;
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
        ? "Tonight's Events"
        : "Today's Events"
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
}: {
  dateHeader: string;
  isToday: boolean;
}) {
  return (
    <StickySectionHeader>
      <span className={cn(isToday && "text-primary")}>{dateHeader}</span>
    </StickySectionHeader>
  );
}

function EventSkeletonGrid({
  count = 8,
  mobileCount,
}: {
  count?: number;
  mobileCount?: number;
}) {
  const renderedMobileCount = mobileCount ?? Math.max(6, count);

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
  showSearchBack,
  onSearchBack,
  shouldShowReturnToCurrentWeekButton,
  onToday,
  onPrevious,
  onNext,
  isPreviousDisabled,
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
  showRecentActivity = false,
  recentActivityTitle,
  recentActivityContent,
  isSearchView,
  isSearching,
  upcomingEventsLoading,
  upcomingEvents,
  filteredEvents,
  flatListTitle,
  flatListEmptyState,
  searchEmptyState,
  upcomingEmptyState,
  dayEmptyState,
  daysToDisplay,
  isCurrentWeek,
  eventsByDay,
  showWeekSkeletons = true,
  skeletonDateHeader,
  defaultContent,
}: EventBrowserSurfaceProps) {
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
            ? "translate-y-0 opacity-100"
            : cn(
                "pointer-events-none opacity-0",
                revealFrom === "bottom" ? "translate-y-8" : "-translate-y-8"
              )
        )}
      >
        <div className="container relative mx-auto pt-4">
          {topSlot}

          <StickySearchBar innerClassName="w-full flex-col items-stretch sm:flex-col sm:items-stretch">
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
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
                        isPreviousDisabled &&
                          "cursor-not-allowed opacity-50 hover:bg-muted"
                      )}
                      onClick={() => void onPrevious()}
                      aria-disabled={isPreviousDisabled}
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
                        isPreviousDisabled &&
                          "cursor-not-allowed opacity-50 hover:bg-muted"
                      )}
                      onClick={() => void onPrevious()}
                      aria-disabled={isPreviousDisabled}
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
              <div className="-mx-4 overflow-x-auto pt-1 [scrollbar-width:none] md:-mx-8 [&::-webkit-scrollbar]:hidden">
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

      {showRecentActivity && recentActivityContent ? (
        <div className="mb-4">
          <StickySectionHeader>{recentActivityTitle}</StickySectionHeader>
          <div className="container mx-auto px-4">{recentActivityContent}</div>
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
              (upcomingEmptyState ?? (
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
              (searchEmptyState ?? (
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
              (flatListEmptyState ?? (
                <EmptyStateCard icon={CalendarIcon} title="No events found" />
              ))
            ) : (
              <HomeMobileEventRail events={filteredEvents} />
            )}
          </div>
        </div>
      ) : null}

      {!showSkeletons && !isSearchView && !flatListTitle
        ? (defaultContent ?? (
            <div className="space-y-4">
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
                    <StickyDateHeader
                      dateHeader={dateHeader}
                      isToday={isToday}
                    />
                    <div className="container mx-auto px-4">
                      {dayEvents.length === 0 ? (
                        (dayEmptyState ?? (
                          <EmptyStateCard
                            icon={CalendarIcon}
                            title="No events scheduled"
                          />
                        ))
                      ) : (
                        <HomeMobileEventRail events={dayEvents} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        : null}
    </div>
  );
}
