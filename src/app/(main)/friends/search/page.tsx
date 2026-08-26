"use client";

import { Suspense, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  UserPlus,
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Building2,
  CalendarDays,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryState } from "nuqs";
import { useAuth } from "@clerk/nextjs";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { PageContainer } from "@/components/shared/page-container";
import { SearchInput } from "@/components/ui/search-input";
import { MobileFilterPills } from "@/components/ui/mobile-filter-pills";
import { formatEventDate } from "@/lib/utils";

type SearchFilter = "all" | "people" | "places" | "events";

const SEARCH_FILTERS = [
  { value: "all", label: "All" },
  { value: "people", label: "People" },
  { value: "places", label: "Places" },
  { value: "events", label: "Events" },
] as const;

function SearchResultImage({
  src,
  alt,
  round = false,
  fallback,
}: {
  src?: string | null;
  alt: string;
  round?: boolean;
  fallback: React.ReactNode;
}) {
  return (
    <div
      className={`relative h-11 w-11 shrink-0 overflow-hidden border border-white/10 bg-[#111113] ${round ? "rounded-full" : "rounded-xl"}`}
    >
      {src ? (
        <Image src={src} alt={alt} fill sizes="44px" className="object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {fallback}
        </div>
      )}
    </div>
  );
}

function MobileResultRow({
  href,
  image,
  title,
  subtitle,
}: {
  href: string;
  image: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[3.75rem] items-center gap-2.5 rounded-xl px-2 py-2 transition-colors active:bg-white/[0.06]"
    >
      {image}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold leading-tight text-white">
          {title}
        </p>
        <p className="mt-0.5 truncate text-[10px] font-medium leading-tight text-white/50">
          {subtitle}
        </p>
      </div>
    </Link>
  );
}

function SearchPageContent() {
  const { toast } = useToast();
  const { userId } = useAuth();
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useQueryState("q", {
    defaultValue: "",
  });
  const [cursor, setCursor] = useState(0);
  const [mobileFilter, setMobileFilter] = useQueryState<SearchFilter>(
    "filter",
    {
      defaultValue: "all",
      parse: (value) =>
        ["all", "people", "places", "events"].includes(value ?? "")
          ? (value as SearchFilter)
          : "all",
      serialize: (value) => value,
    }
  );
  const pageSize = 20;

  const eventRange = useMemo(() => {
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 2);
    return { startDate, endDate };
  }, []);

  const { data: searchResults, isLoading: searchLoading } =
    trpc.friends.searchUsers.useQuery(
      { query: searchQuery, limit: 20, includeAll: true },
      { enabled: searchQuery.length >= 2 }
    );

  const { data: placeResults, isLoading: placesLoading } =
    trpc.place.listPlaces.useQuery({
      search: searchQuery.trim() || undefined,
      limit: 30,
    });

  const { data: eventResults, isLoading: eventsLoading } =
    trpc.event.listEventsByRange.useQuery({
      ...eventRange,
      search: searchQuery.trim() || undefined,
      limit: 30,
    });

  const { data: recentUsers, isLoading: recentLoading } =
    trpc.friends.getRecentUsers.useQuery(
      { limit: pageSize, cursor },
      { enabled: searchQuery.length < 2 }
    );
  const { data: friends = [] } = trpc.friends.listFriends.useQuery({});

  const sendRequestMutation = trpc.friends.sendFriendRequest.useMutation({
    onSuccess: () => {
      // toast({
      //   title: "Friend request sent",
      //   description: "Your friend request has been sent",
      // });
      utils.friends.searchUsers.invalidate();
      utils.friends.getRecentUsers.invalidate();
      utils.friends.listFriends.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleNextPage = () => {
    if (recentUsers?.nextCursor !== null) {
      setCursor(recentUsers?.nextCursor ?? 0);
    }
  };

  const handlePrevPage = () => {
    setCursor(Math.max(0, cursor - pageSize));
  };

  const currentPage = Math.floor(cursor / pageSize) + 1;
  const relatedUserIds = new Set(
    friends.map((friendship) => friendship.friend?.id).filter(Boolean)
  );
  const isAlreadyAdded = (targetUserId: string) =>
    relatedUserIds.has(targetUserId);

  const mobilePeople =
    searchQuery.length >= 2
      ? (searchResults ?? [])
      : (recentUsers?.items ?? []);
  const sectionLimit = mobileFilter === "all" ? 8 : undefined;
  const showPeople = mobileFilter === "all" || mobileFilter === "people";
  const showPlaces = mobileFilter === "all" || mobileFilter === "places";
  const showEvents = mobileFilter === "all" || mobileFilter === "events";
  const mobileLoading =
    (searchQuery.length >= 2 ? searchLoading : recentLoading) ||
    placesLoading ||
    eventsLoading;

  return (
    <PageContainer className="min-h-screen bg-black !px-2 !pt-0 md:bg-background md:!px-4 md:!pt-4">
      <div>
        <div className="sticky top-0 z-40 bg-black px-1 pb-3 pt-3">
          <SearchInput
            placeholder="Search..."
            value={searchQuery}
            onChange={(value) => {
              void setSearchQuery(value);
              setCursor(0);
            }}
            className="h-12 [&_input]:h-12 [&_input]:rounded-full [&_input]:border-white/15 [&_input]:bg-[#242426]/85 [&_input]:text-base [&_input]:backdrop-blur-2xl"
          />
          <MobileFilterPills
            options={SEARCH_FILTERS}
            value={mobileFilter}
            onValueChange={setMobileFilter}
            className="-mx-3 mt-4 pl-3"
          />
        </div>

        {mobileLoading && !mobilePeople.length ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-7 w-7 animate-spin text-white/35" />
          </div>
        ) : (
          <div className="pb-4 pt-2">
            {showPeople && mobilePeople.length > 0 && (
              <section className="mb-5">
                <h2 className="px-2 pb-2 text-xl font-bold text-white">
                  People
                </h2>
                {mobilePeople.slice(0, sectionLimit).map((user) => {
                  const displayName =
                    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
                    user.username ||
                    "Wig user";
                  return (
                    <MobileResultRow
                      key={user.id}
                      href={user.username ? `/${user.username}` : "/profile"}
                      image={
                        <UserAvatar
                          src={user.avatarImageUrl}
                          name={displayName}
                          identityKey={user.id}
                          className="h-11 w-11 rounded-full"
                          size={44}
                        />
                      }
                      title={displayName}
                      subtitle={user.username ? `@${user.username}` : "Person"}
                    />
                  );
                })}
              </section>
            )}

            {showPlaces && placeResults && placeResults.length > 0 && (
              <section className="mb-5">
                <h2 className="px-2 pb-2 text-xl font-bold text-white">
                  Places
                </h2>
                {placeResults.slice(0, sectionLimit).map((place) => (
                  <MobileResultRow
                    key={place.id}
                    href={`/${place.type === "venue" ? "venue" : "organizer"}/${place.slug}`}
                    image={
                      <SearchResultImage
                        src={place.logoImageUrl}
                        alt={place.name}
                        fallback={
                          <Building2 className="h-5 w-5 text-white/25" />
                        }
                      />
                    }
                    title={place.name}
                    subtitle={`${place.type === "venue" ? "Venue" : "Organizer"}${place.eventCount ? ` · ${place.eventCount} upcoming ${place.eventCount === 1 ? "event" : "events"}` : ""}${place.isFollowing ? " · Following" : ""}`}
                  />
                ))}
              </section>
            )}

            {showEvents && eventResults && eventResults.length > 0 && (
              <section className="mb-5">
                <h2 className="px-2 pb-2 text-xl font-bold text-white">
                  Events
                </h2>
                {eventResults.slice(0, sectionLimit).map((event) => (
                  <MobileResultRow
                    key={event.id}
                    href={`/event/${event.publicId ?? event.id}`}
                    image={
                      <SearchResultImage
                        src={event.coverImageUrl}
                        alt={event.title}
                        fallback={
                          <CalendarDays className="h-5 w-5 text-white/25" />
                        }
                      />
                    }
                    title={event.title}
                    subtitle={`${event.venue?.name ?? event.city} · ${formatEventDate(new Date(event.startAt), event.timeZone, event.state, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
                  />
                ))}
              </section>
            )}

            {!mobileLoading &&
              (!showPeople || mobilePeople.length === 0) &&
              (!showPlaces || !placeResults?.length) &&
              (!showEvents || !eventResults?.length) && (
                <div className="py-12 text-center text-sm text-white/50">
                  No results found
                </div>
              )}
          </div>
        )}
      </div>

      <div className="hidden">
        <BackButtonHeader
          backHref="/activity"
          title="Find Friends"
          subtitle="Search by name or username to connect with more people"
        />

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or username..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCursor(0); // Reset pagination when searching
            }}
            className="pl-9"
          />
        </div>

        {searchQuery.length >= 2 ? (
          // Search Results
          <>
            {searchLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !searchResults || searchResults.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                No users found
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {searchResults.length}{" "}
                  {searchResults.length === 1 ? "result" : "results"} found
                </p>
                {searchResults.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        src={user.avatarImageUrl}
                        name={user.firstName}
                        identityKey={user.id}
                      />
                      <div>
                        <p className="font-medium">
                          {user.firstName} {user.lastName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          @{user.username}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isAlreadyAdded(user.id) ? "outline" : "default"}
                      onClick={() => {
                        if (isAlreadyAdded(user.id)) return;
                        sendGoogleAnalyticsEvent(
                          "friend_request_sent",
                          userId,
                          {
                            target_user_id: user.id,
                            source: "friend_search_page_results",
                          }
                        );
                        sendRequestMutation.mutate({ friendUserId: user.id });
                      }}
                      disabled={
                        sendRequestMutation.isPending || isAlreadyAdded(user.id)
                      }
                    >
                      {!isAlreadyAdded(user.id) && (
                        <UserPlus className="mr-2 h-4 w-4" />
                      )}
                      {isAlreadyAdded(user.id) ? "Added" : "Add Friend"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          // Recent Users
          <>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Recently Joined</h2>

              {recentLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !recentUsers?.items || recentUsers.items.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  No users to show
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {recentUsers.items.map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between rounded-lg border p-4"
                      >
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            src={user.avatarImageUrl}
                            name={user.firstName}
                            identityKey={user.id}
                          />
                          <div>
                            <p className="font-medium">
                              {user.firstName} {user.lastName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              @{user.username}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={
                            isAlreadyAdded(user.id) ? "outline" : "default"
                          }
                          onClick={() => {
                            if (isAlreadyAdded(user.id)) return;
                            sendGoogleAnalyticsEvent(
                              "friend_request_sent",
                              userId,
                              {
                                target_user_id: user.id,
                                source: "friend_search_page_recent",
                              }
                            );
                            sendRequestMutation.mutate({
                              friendUserId: user.id,
                            });
                          }}
                          disabled={
                            sendRequestMutation.isPending ||
                            isAlreadyAdded(user.id)
                          }
                        >
                          {!isAlreadyAdded(user.id) && (
                            <UserPlus className="mr-2 h-4 w-4" />
                          )}
                          {isAlreadyAdded(user.id) ? "Added" : "Add Friend"}
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePrevPage}
                      disabled={cursor === 0}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {currentPage}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleNextPage}
                      disabled={recentUsers.nextCursor === null}
                    >
                      Next
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </PageContainer>
  );
}

export default function SearchPage() {
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
      <SearchPageContent />
    </Suspense>
  );
}
