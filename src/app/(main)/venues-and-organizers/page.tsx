"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Suspense,
  useMemo,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { trpc } from "@/lib/trpc";
import { SearchInput } from "@/components/ui/search-input";
import { useNavbarSearch } from "@/contexts/nav-search-context";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building,
  Building2,
  CalendarDays,
  ListFilter,
  MapPin,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useQueryState } from "nuqs";
import { ResponsiveSelect } from "@/components/ui/responsive-select";
import { resolveMetroArea } from "@/lib/metro-areas";
import { cn } from "@/lib/utils";
import { StickySearchBar } from "@/components/ui/sticky-search-bar";
import { HapticPreset, useHaptics } from "@/hooks/use-haptics";
import { PageContainer } from "@/components/shared/page-container";
import { MobileFilterPills } from "@/components/ui/mobile-filter-pills";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type FilterType = "all" | "venues" | "organizers" | "following";

const MOBILE_PLACE_FILTERS: Array<{ value: FilterType; label: string }> = [
  { value: "all", label: "All" },
  { value: "following", label: "Following" },
  { value: "venues", label: "Venues" },
  { value: "organizers", label: "Organizers" },
];

const PLACE_INDEX = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

function MobilePlaceLogo({ item }: { item: any }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#111113]">
      {item.logoImageUrl && !failed ? (
        <Image
          src={item.logoImageUrl}
          alt=""
          fill
          sizes="44px"
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {item.type === "venue" ? (
            <Building className="h-5 w-5 text-white/25" />
          ) : (
            <Building2 className="h-5 w-5 text-white/25" />
          )}
        </div>
      )}
    </div>
  );
}

function MobilePlacesList({ items }: { items: any[] }) {
  const availableLetters = useMemo(
    () =>
      new Set(
        items.map((item) =>
          /^[A-Z]/i.test(item.name) ? item.name[0].toUpperCase() : "#"
        )
      ),
    [items]
  );

  const scrollToLetter = (letter: string) => {
    document
      .getElementById(`place-letter-${letter}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="relative md:hidden">
      <div className="pr-6">
        {items.map((item, index) => {
          const letter = /^[A-Z]/i.test(item.name)
            ? item.name[0].toUpperCase()
            : "#";
          const previous = items[index - 1];
          const previousLetter = previous
            ? /^[A-Z]/i.test(previous.name)
              ? previous.name[0].toUpperCase()
              : "#"
            : null;

          return (
            <Link
              id={
                letter !== previousLetter ? `place-letter-${letter}` : undefined
              }
              key={`${item.type}-${item.id}`}
              href={`/${item.type === "venue" ? "venue" : "organizer"}/${item.slug}`}
              className="flex min-h-[3.75rem] scroll-mt-40 items-center gap-2.5 rounded-xl px-2 py-2 transition-colors active:bg-white/[0.06]"
            >
              <MobilePlaceLogo item={item} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[13px] font-semibold leading-tight text-white">
                  {item.name}
                </h2>
                <p className="mt-0.5 truncate text-[10px] font-medium leading-tight text-white/50">
                  <span className="capitalize">{item.type}</span>
                  {item.eventCount > 0
                    ? ` · ${item.eventCount} upcoming ${item.eventCount === 1 ? "event" : "events"}`
                    : ""}
                  {item.isFollowing ? " · Following" : ""}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="fixed right-1 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center text-[10px] font-semibold leading-[13px] md:hidden">
        {PLACE_INDEX.map((letter) => (
          <button
            key={letter}
            type="button"
            disabled={!availableLetters.has(letter)}
            onClick={() => scrollToLetter(letter)}
            className="w-5 text-center text-white/55 disabled:text-white/15"
            aria-label={`Jump to places beginning with ${letter}`}
          >
            {letter}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlaceSkeletonGrid({ count = 9 }: { count?: number }) {
  return (
    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={`place-skeleton-${index}`}
          className="h-28 rounded-2xl bg-card p-2"
        >
          <div className="flex h-full animate-pulse">
            <div className="h-24 w-24 flex-shrink-0 rounded-2xl bg-muted" />
            <div className="flex-1 space-y-2 py-1 pl-3 pr-1">
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

function PlacesPageContent() {
  const { setShowNavbarSearch, registerScrollToSearch } = useNavbarSearch();
  const { triggerHaptic } = useHaptics();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isSticky, setIsSticky] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Scroll to top and focus search input when navbar search button is clicked
  const scrollToSearchAndFocus = useCallback(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    searchInputRef.current?.focus();
  }, []);

  // Register the scroll callback with the navbar context
  useEffect(() => {
    registerScrollToSearch(scrollToSearchAndFocus);
  }, [registerScrollToSearch, scrollToSearchAndFocus]);

  // Update navbar search button visibility based on scroll position
  useEffect(() => {
    setShowNavbarSearch(isSticky);
  }, [isSticky, setShowNavbarSearch]);

  // Fade the secondary mobile header controls once the page starts scrolling.
  useEffect(() => {
    const handleScroll = () => setIsSticky(window.scrollY > 0);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const [searchQuery, setSearchQuery] = useQueryState("search", {
    defaultValue: "",
  });
  const [selectedCity, setSelectedCity] = useQueryState<string | null>("city", {
    defaultValue: null,
    parse: (value) => value || null,
    serialize: (value) => value || "",
  });
  const [filterType, setFilterType] = useQueryState<FilterType>("filter", {
    defaultValue: "all",
    parse: (value) =>
      ["all", "venues", "organizers", "following"].includes(value || "")
        ? (value as FilterType)
        : "all",
    serialize: (value) => value,
  });

  // Get current user to show their city
  const { data: currentUser, isLoading: isLoadingUser } =
    trpc.user.getCurrentUser.useQuery();

  // Get available cities
  const { data: cities } = trpc.event.getAvailableCities.useQuery();
  const { data: activeCategories } = trpc.category.listActive.useQuery();

  // Determine the effective city: use URL param if set, otherwise resolve user's city to metro
  const effectiveCity = useMemo(() => {
    if (selectedCity) return selectedCity;
    if (!currentUser?.city) return null;
    if (!cities) return currentUser.city;
    const metro = resolveMetroArea(currentUser.city, currentUser.state, cities);
    return metro?.city ?? currentUser.city;
  }, [selectedCity, currentUser?.city, currentUser?.state, cities]);

  // Don't run queries until we know the user's city (to avoid flash of "all cities")
  const isReady = !isLoadingUser;

  // Determine place type filter
  const isFilteredPlacesView = filterType !== "all";
  const placeType =
    filterType === "venues"
      ? "venue"
      : filterType === "organizers"
        ? "organizer"
        : undefined;

  // Fetch places
  const { data: placesData, isLoading: isLoadingPlaces } =
    trpc.place.listPlaces.useQuery(
      {
        type: placeType,
        search: searchQuery || undefined,
        city:
          effectiveCity && effectiveCity !== "all" ? effectiveCity : undefined,
        followedOnly: filterType === "following",
        limit: 50,
      },
      {
        enabled: isReady,
      }
    );

  // Combine and sort places alphabetically
  const combinedItems = useMemo(() => {
    if (!placesData) return [];

    return placesData
      .map((place) => ({
        type: place.type,
        id: place.id,
        name: place.name,
        description: place.description,
        city: place.city,
        state: place.state,
        slug: place.slug,
        logoImageUrl: place.logoImageUrl,
        latitude: place.latitude,
        longitude: place.longitude,
        eventCount: place.eventCount,
        isFollowing: place.isFollowing,
        categories: place.categories ?? [],
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
  }, [placesData]);

  const availableCategoryKeys = useMemo(() => {
    const keys = new Set<string>();

    combinedItems.forEach((item) =>
      item.categories.forEach((category) => keys.add(category))
    );

    return keys;
  }, [combinedItems]);

  const visibleCategories = useMemo(
    () =>
      (activeCategories ?? []).filter((category) =>
        availableCategoryKeys.has(category.key)
      ),
    [activeCategories, availableCategoryKeys]
  );

  useEffect(() => {
    setSelectedCategories((prev) =>
      prev.filter((category) => availableCategoryKeys.has(category))
    );
  }, [availableCategoryKeys]);

  const filteredItems = useMemo(() => {
    if (selectedCategories.length === 0) return combinedItems;

    return combinedItems.filter((item) =>
      selectedCategories.every((category) => item.categories.includes(category))
    );
  }, [combinedItems, selectedCategories]);

  const toggleCategory = useCallback((categoryKey: string) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryKey)
        ? prev.filter((key) => key !== categoryKey)
        : [...prev, categoryKey]
    );
  }, []);

  const handleBackFromSearchOrFilter = useCallback(() => {
    setIsSearchMode(false);
    searchInputRef.current?.blur();

    if (isFilteredPlacesView) {
      setFilterType("all");
    }
  }, [isFilteredPlacesView, setFilterType]);

  const isLoading = isLoadingPlaces;

  return (
    <PageContainer className="min-h-screen bg-black !px-2 !pt-0 md:bg-background md:!px-4 md:!pt-4">
      {/* Search and Filters */}
      <div className="fixed inset-x-0 top-0 z-40 px-3 pb-3 pt-3 md:hidden">
        {isSearchMode ? (
          <Suspense fallback={null}>
            <SearchInput
              ref={searchInputRef}
              placeholder="Search places..."
              value={searchQuery}
              onChange={setSearchQuery}
              showBack
              onBack={handleBackFromSearchOrFilter}
              className="h-12"
            />
          </Suspense>
        ) : (
          <div className="grid h-12 grid-cols-[5.75rem_1fr_5.75rem] items-center">
            <div className="flex h-12 overflow-hidden rounded-3xl border border-white/15 bg-[#242426]/85 shadow-lg backdrop-blur-2xl">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex flex-1 items-center justify-center"
                    aria-label="Filter places"
                  >
                    <ListFilter className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel>Categories</DropdownMenuLabel>
                  {visibleCategories.length > 0 ? (
                    visibleCategories.map((category) => (
                      <DropdownMenuCheckboxItem
                        key={category.id}
                        checked={selectedCategories.includes(category.key)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() => toggleCategory(category.key)}
                      >
                        {category.label}
                      </DropdownMenuCheckboxItem>
                    ))
                  ) : (
                    <div className="px-2 py-2 text-sm text-muted-foreground">
                      No categories available
                    </div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                onClick={() => {
                  setIsSearchMode(true);
                  window.requestAnimationFrame(() =>
                    searchInputRef.current?.focus()
                  );
                }}
                className="flex flex-1 items-center justify-center"
                aria-label="Search places"
              >
                <Search className="h-[1.125rem] w-[1.125rem]" />
              </button>
            </div>
            <h1
              className={cn(
                "text-center text-xl font-bold transition-opacity duration-300 ease-in-out",
                isSticky && "opacity-0"
              )}
            >
              Places
            </h1>
          </div>
        )}

        {!isSearchMode ? (
          <MobileFilterPills
            options={MOBILE_PLACE_FILTERS}
            value={filterType}
            onValueChange={setFilterType}
            className={cn(
              "-mx-3 mt-4 pl-3 transition-opacity duration-300 ease-in-out",
              isSticky && "pointer-events-none opacity-0"
            )}
          />
        ) : null}
      </div>
      <div
        className={cn("md:hidden", isSearchMode ? "h-[4.5rem]" : "h-[7.5rem]")}
        aria-hidden="true"
      />

      <StickySearchBar
        className="hidden md:block"
        innerClassName="w-full flex-col items-stretch sm:flex-col sm:items-stretch"
      >
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex w-full flex-row">
            <Suspense fallback={null}>
              <SearchInput
                ref={searchInputRef}
                placeholder="Search venues & organizers..."
                value={searchQuery}
                onChange={setSearchQuery}
                onFocus={() => setIsSearchMode(true)}
                showBack={isSearchMode || isFilteredPlacesView}
                onBack={handleBackFromSearchOrFilter}
                className="w-full"
              />
            </Suspense>
          </div>

          {/* Filters */}
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

            {/* Type Filter */}
            <ResponsiveSelect
              value={filterType}
              onValueChange={(value) => setFilterType(value as FilterType)}
              options={[
                { value: "all", label: "All" },
                { value: "venues", label: "Venues" },
                { value: "organizers", label: "Organizers" },
                { value: "following", label: "Following" },
              ]}
              placeholder="Filter"
              title="Filter Places"
              className="min-w-0 flex-1 sm:w-[180px] sm:flex-none"
            />
          </div>
        </div>

        {(isLoading || visibleCategories.length > 0) && (
          <div className="-mx-4 overflow-x-auto pt-1 [scrollbar-width:none] sm:-mx-0 [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-1.5 px-4 sm:px-0">
              {isLoading
                ? [64, 80, 56, 72].map((width, i) => (
                    <div
                      key={`place-pill-skeleton-${i}`}
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

      {/* Loading State */}
      {(isLoading || !isReady) && (
        <div className="hidden md:block">
          <PlaceSkeletonGrid />
        </div>
      )}
      {(isLoading || !isReady) && (
        <div className="space-y-3 pr-6 md:hidden">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="flex animate-pulse items-center gap-4 px-2 py-2"
            >
              <div className="h-[3.25rem] w-[3.25rem] rounded-[14px] bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 rounded bg-white/10" />
                <div className="h-3 w-4/5 rounded bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Combined Grid */}
      {!isLoading && isReady && filteredItems.length > 0 && (
        <>
          <MobilePlacesList items={filteredItems} />
          <div className="hidden gap-2 md:grid md:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map((item) => (
              <Link
                key={`${item.type}-${item.id}`}
                href={`/${item.type === "venue" ? "venue" : "organizer"}/${item.slug}`}
              >
                <Card className="relative h-28 cursor-pointer overflow-hidden !border-none bg-card p-2 transition-all duration-300 hover:bg-accent/50">
                  <div className="flex h-full">
                    <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-2xl bg-muted">
                      {item.logoImageUrl ? (
                        <Image
                          src={item.logoImageUrl}
                          alt={item.name}
                          fill
                          className="object-cover"
                          sizes="96px"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          {item.type === "venue" ? (
                            <Building className="h-8 w-8 text-muted-foreground/40" />
                          ) : (
                            <Building2 className="h-8 w-8 text-muted-foreground/40" />
                          )}
                        </div>
                      )}
                    </div>

                    <div className="font-space-grotesk flex flex-1 flex-col justify-between py-1 pl-3 pr-1">
                      <div className="space-y-1.5">
                        <h3 className="line-clamp-2 text-base font-medium leading-tight">
                          {item.name}
                        </h3>
                        {item.city && item.state && (
                          <div className="flex items-center gap-1.5 text-sm font-medium text-neon-teal">
                            {/*<MapPin className="h-3.5 w-3.5" />*/}
                            <span>
                              {item.city}, {item.state}
                            </span>
                          </div>
                        )}
                        <div
                          className={cn(
                            "flex items-center gap-1.5 text-sm",
                            item.eventCount === 0
                              ? "hidden"
                              : "text-muted-foreground"
                          )}
                        >
                          {/*<CalendarDays className="h-3.5 w-3.5" />*/}
                          <span>
                            {item.eventCount} upcoming{" "}
                            {item.eventCount === 1 ? "event" : "events"}
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <span className="text-xs text-muted-foreground/50">
                          {item.type === "venue" ? "Venue" : "Organizer"}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Empty State */}
      {!isLoading && isReady && filteredItems.length === 0 && (
        <Card className={"mt-4"}>
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex justify-center gap-2">
              <Building className="h-10 w-10 text-muted-foreground" />
              <Building2 className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">No results found</h3>
            <p className="mb-4 text-muted-foreground">
              {selectedCategories.length > 0
                ? "Try removing a category filter or adjusting your search"
                : filterType === "following"
                  ? "You aren't following any venues or organizers yet"
                  : searchQuery
                    ? "Try adjusting your search or filters"
                    : "No venues or organizers available yet"}
            </p>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}

export default function PlacesPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto py-8">
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      }
    >
      <PlacesPageContent />
    </Suspense>
  );
}
