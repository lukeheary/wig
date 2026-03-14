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
  MapPin,
  Loader2,
} from "lucide-react";
import { useQueryState } from "nuqs";
import { ResponsiveSelect } from "@/components/ui/responsive-select";
import { resolveMetroArea } from "@/lib/metro-areas";
import { cn } from "@/lib/utils";
import { StickySearchBar } from "@/components/ui/sticky-search-bar";

type FilterType = "all" | "venues" | "organizers" | "following";

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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const [isSticky, setIsSticky] = useState(false);

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

  // Observe when the search section scrolls out of view
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSticky(!entry.isIntersecting);
      },
      { threshold: [1], rootMargin: "-1px 0px 0px 0px" }
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
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
  }, [placesData]);

  const isLoading = isLoadingPlaces;

  return (
    <div className="container mx-auto pb-8 pt-4">
      {/* Sticky sentinel for intersection observer */}
      <div ref={stickySentinelRef} className="h-px w-full" />

      {/* Search and Filters */}
      <StickySearchBar>
        <Suspense fallback={null}>
          <SearchInput
            ref={searchInputRef}
            placeholder="Search venues & organizers..."
            value={searchQuery}
            onChange={setSearchQuery}
            className="w-full"
          />
        </Suspense>

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
      </StickySearchBar>

      {/* Loading State */}
      {(isLoading || !isReady) && <PlaceSkeletonGrid />}

      {/* Combined Grid */}
      {!isLoading && isReady && combinedItems.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {combinedItems.map((item) => (
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

                  <div className="flex flex-1 flex-col justify-between py-1 pl-3 pr-1">
                    <div className="space-y-1">
                      <h3 className="line-clamp-2 text-base font-bold leading-tight">
                        {item.name}
                      </h3>
                      {item.city && item.state && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
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
                        <CalendarDays className="h-3.5 w-3.5" />
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
      )}

      {/* Empty State */}
      {!isLoading && isReady && combinedItems.length === 0 && (
        <Card className={"mt-4"}>
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex justify-center gap-2">
              <Building className="h-10 w-10 text-muted-foreground" />
              <Building2 className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">No results found</h3>
            <p className="mb-4 text-muted-foreground">
              {filterType === "following"
                ? "You aren't following any venues or organizers yet"
                : searchQuery
                  ? "Try adjusting your search or filters"
                  : "No venues or organizers available yet"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
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
