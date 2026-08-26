"use client";

import {
  Suspense,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { trpc } from "@/lib/trpc";
import { SearchInput } from "@/components/ui/search-input";
import { useNavbarSearch } from "@/contexts/nav-search-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, UserPlus, X, Users, Mail } from "lucide-react";
import { ActivityFeed } from "@/components/friends/activity-feed";
import { useToast } from "@/hooks/use-toast";
import { useQueryState } from "nuqs";
import pluralize from "pluralize";
import { UserList } from "@/components/user-list";
import { StickySearchBar } from "@/components/ui/sticky-search-bar";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { useAuth } from "@clerk/nextjs";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import { PageContainer } from "@/components/shared/page-container";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { MobileFilterPills } from "@/components/ui/mobile-filter-pills";

type FriendsView = "discover" | "list" | "requests";
type ActivityTiming = "upcoming" | "past";

const ACTIVITY_FILTERS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
] as const;

function FriendsPageContent() {
  const { toast } = useToast();
  const { userId } = useAuth();
  const utils = trpc.useUtils();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [isSticky, setIsSticky] = useState(false);
  const { setShowNavbarSearch, registerScrollToSearch } = useNavbarSearch();
  const [activeView, setActiveView] = useQueryState<FriendsView>("view", {
    defaultValue: "discover",
    parse: (value) =>
      value === "list" || value === "requests" ? value : "discover",
    serialize: (value) => value,
  });
  const [searchQuery, setSearchQuery] = useQueryState("q", {
    defaultValue: "",
  });
  const [friendsListSearchQuery, setFriendsListSearchQuery] = useState("");
  const [requestsSearchQuery, setRequestsSearchQuery] = useState("");
  const [activityTiming, setActivityTiming] =
    useState<ActivityTiming>("upcoming");

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

  // Fetch friends
  const { data: friends, isLoading: friendsLoading } =
    trpc.friends.listFriends.useQuery({});
  const { data: pendingRequests } = trpc.friends.listFriends.useQuery({
    statusFilter: "pending",
  });
  const acceptedFriends = friends?.filter((f) => f.status === "accepted") || [];
  const shouldShowRecentUsers =
    (isSearchMode && searchQuery.length < 2) ||
    (!isSearchMode &&
      activeView === "discover" &&
      !friendsLoading &&
      !!friends &&
      acceptedFriends.length === 0);

  // Search users (includes friends and non-friends)
  const { data: searchResults, isLoading: searchLoading } =
    trpc.friends.searchUsers.useQuery(
      { query: searchQuery, limit: 20, includeAll: true },
      { enabled: searchQuery.length >= 2 }
    );

  // Recent users (for when search is focused but no query)
  const { data: recentUsers, isLoading: recentLoading } =
    trpc.friends.getRecentUsers.useQuery(
      { limit: 20, cursor: 0 },
      { enabled: shouldShowRecentUsers }
    );

  const sentRequests = pendingRequests?.filter((f) => f.isSender) || [];
  const receivedRequests = pendingRequests?.filter((f) => !f.isSender) || [];
  const relatedUserIds = new Set(
    (friends ?? []).map((friendship) => friendship.friend?.id).filter(Boolean)
  );

  // Mutations
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

  const acceptMutation = trpc.friends.acceptFriendRequest.useMutation({
    onSuccess: () => {
      // toast({
      //   title: "Friend request accepted",
      //   description: "You are now friends",
      // });
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

  const rejectMutation = trpc.friends.rejectFriendRequest.useMutation({
    onSuccess: () => {
      // toast({ title: "Friend request rejected" });
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

  // Check if a user in search results is already a friend
  const isFriend = (userId: string) => {
    return acceptedFriends.some((f) => f.friend?.id === userId);
  };

  const isAlreadyAdded = (userId: string) => relatedUserIds.has(userId);

  // Sort search results: friends first, then others
  const sortedSearchResults = searchResults
    ? [...searchResults].sort((a, b) => {
        const aIsFriend = isFriend(a.id);
        const bIsFriend = isFriend(b.id);
        if (aIsFriend && !bIsFriend) return -1;
        if (!aIsFriend && bIsFriend) return 1;
        return 0;
      })
    : [];

  const handleExitSearch = () => {
    setIsSearchMode(false);
    setSearchQuery("");
    searchInputRef.current?.blur();
  };

  const openFriendsView = (view: Exclude<FriendsView, "discover">) => {
    setIsSearchMode(false);
    setSearchQuery("");
    if (view === "list") {
      setFriendsListSearchQuery("");
    }
    if (view === "requests") {
      setRequestsSearchQuery("");
    }
    void setActiveView(view);
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    });
  };

  const handleExitSubView = () => {
    void setActiveView("discover");
    searchInputRef.current?.blur();
  };

  const isSearching = searchQuery.length >= 2;
  const isSubView = activeView !== "discover";
  const activeSearchValue =
    activeView === "list"
      ? friendsListSearchQuery
      : activeView === "requests"
        ? requestsSearchQuery
        : searchQuery;
  const activeSearchPlaceholder =
    activeView === "list"
      ? "Search your friends..."
      : activeView === "requests"
        ? "Search requests..."
        : "Search friends or find new people...";

  const filteredFriends = useMemo(() => {
    const query = friendsListSearchQuery.trim().toLowerCase();
    if (!query) return acceptedFriends;

    return acceptedFriends.filter((friend) => {
      const firstName = friend.friend?.firstName?.toLowerCase() ?? "";
      const lastName = friend.friend?.lastName?.toLowerCase() ?? "";
      const username = friend.friend?.username?.toLowerCase() ?? "";
      const fullName = `${firstName} ${lastName}`.trim();

      return (
        fullName.includes(query) ||
        firstName.includes(query) ||
        lastName.includes(query) ||
        username.includes(query)
      );
    });
  }, [acceptedFriends, friendsListSearchQuery]);

  const normalizedRequestQuery = requestsSearchQuery.trim().toLowerCase();
  const matchesRequestQuery = useCallback(
    (request: (typeof sentRequests)[number]) => {
      if (!normalizedRequestQuery) return true;

      const firstName = request.friend?.firstName?.toLowerCase() ?? "";
      const lastName = request.friend?.lastName?.toLowerCase() ?? "";
      const username = request.friend?.username?.toLowerCase() ?? "";
      const fullName = `${firstName} ${lastName}`.trim();

      return (
        fullName.includes(normalizedRequestQuery) ||
        firstName.includes(normalizedRequestQuery) ||
        lastName.includes(normalizedRequestQuery) ||
        username.includes(normalizedRequestQuery)
      );
    },
    [normalizedRequestQuery]
  );

  const filteredReceivedRequests = useMemo(
    () => receivedRequests.filter(matchesRequestQuery),
    [receivedRequests, matchesRequestQuery]
  );
  const filteredSentRequests = useMemo(
    () => sentRequests.filter(matchesRequestQuery),
    [sentRequests, matchesRequestQuery]
  );
  const hasAnyRequests = receivedRequests.length > 0 || sentRequests.length > 0;

  const renderRecentlyJoined = () => (
    <>
      <StickySectionHeader className="-mx-4">
        <h2>Recently Joined</h2>
      </StickySectionHeader>
      {recentLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !recentUsers?.items || recentUsers.items.length === 0 ? (
        <EmptyStateCard icon={Users} title="No recent members to show" />
      ) : (
        <UserList
          items={recentUsers.items}
          getUser={(user) => user}
          renderBadges={(user) =>
            isFriend(user.id) ? (
              <Badge variant="secondary" className="text-xs">
                Friend
              </Badge>
            ) : null
          }
          renderAction={(user) =>
            isAlreadyAdded(user.id) ? (
              <Button size="sm" disabled variant="outline">
                Added
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  sendGoogleAnalyticsEvent("friend_request_sent", userId, {
                    target_user_id: user.id,
                    source: isSearchMode
                      ? "friends_recent_users"
                      : "friends_zero_state_recent_users",
                  });
                  sendRequestMutation.mutate({ friendUserId: user.id });
                }}
                disabled={sendRequestMutation.isPending}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Add
              </Button>
            )
          }
        />
      )}
    </>
  );

  return (
    <PageContainer className="min-h-screen bg-black !pt-3 md:bg-background md:!pt-4">
      {/* Sticky sentinel for intersection observer */}
      <div ref={stickySentinelRef} className="h-px w-full" />

      {!isSubView && !isSearchMode && (
        <div className="mb-5 md:hidden">
          <div className="flex h-12 items-center justify-center">
            <h1 className="text-center text-xl font-bold">Activity</h1>
          </div>
          <MobileFilterPills
            options={ACTIVITY_FILTERS}
            value={activityTiming}
            onValueChange={setActivityTiming}
            className="mt-4"
          />
        </div>
      )}

      <StickySearchBar
        className="hidden md:block"
        innerClassName="w-full flex-col items-stretch sm:flex-col sm:items-stretch"
      >
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex w-full flex-row">
            <Suspense fallback={null}>
              <SearchInput
                ref={searchInputRef}
                placeholder={activeSearchPlaceholder}
                value={activeSearchValue}
                onChange={(value) => {
                  if (activeView === "list") {
                    setFriendsListSearchQuery(value);
                    return;
                  }

                  if (activeView === "requests") {
                    setRequestsSearchQuery(value);
                    return;
                  }

                  setSearchQuery(value);
                }}
                onFocus={() => {
                  if (activeView === "discover") {
                    setIsSearchMode(true);
                  }
                }}
                showBack={isSearchMode || isSubView}
                onBack={isSubView ? handleExitSubView : handleExitSearch}
                className="w-full"
              />
            </Suspense>
          </div>

          <div
            className={cn(
              "flex w-full shrink-0 gap-2 overflow-hidden transition-all duration-200 ease-out",
              "max-h-16 opacity-100 sm:w-[264px] lg:w-[328px]"
            )}
          >
            <button
              type="button"
              onClick={() => openFriendsView("list")}
              className="flex-1 sm:w-32 sm:flex-none lg:w-40"
            >
              <div className="flex h-12 cursor-pointer items-center justify-between rounded-full bg-muted px-5 transition-colors hover:bg-muted/80">
                <p className="flex flex-row items-center gap-1.5 text-base font-medium lg:text-lg">
                  <span>{acceptedFriends.length}</span>
                  <span className="text-sm text-muted-foreground">
                    {pluralize("Friend", acceptedFriends.length)}
                  </span>
                </p>
                <ChevronRight
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-opacity lg:h-5 lg:w-5",
                    activeView === "list" && "opacity-0"
                  )}
                />
              </div>
            </button>
            <button
              type="button"
              onClick={() => openFriendsView("requests")}
              className="flex-1 sm:w-32 sm:flex-none lg:w-40"
            >
              <div className="flex h-12 cursor-pointer items-center justify-between rounded-full bg-muted px-5 transition-colors hover:bg-muted/80">
                <p className="flex flex-row items-center gap-1.5 text-base font-medium lg:text-lg">
                  <span>{receivedRequests.length}</span>
                  <span className="text-sm text-muted-foreground">
                    {pluralize("Request", receivedRequests.length)}
                  </span>
                </p>
                <ChevronRight
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-opacity lg:h-5 lg:w-5",
                    activeView === "requests" && "opacity-0"
                  )}
                />
              </div>
            </button>
          </div>
        </div>
      </StickySearchBar>

      {isSubView ? (
        activeView === "list" ? (
          <>
            <StickySectionHeader className="-mx-4">
              <h2 className="tracking-tight">My Friends</h2>
            </StickySectionHeader>

            <Card>
              <CardContent className="pt-6">
                {!friends ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : acceptedFriends.length === 0 ? (
                  <EmptyStateCard
                    icon={Users}
                    title="You don't have any friends yet"
                    description="Use the Find Friends page to connect with people"
                    showCard={false}
                  />
                ) : filteredFriends.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    No friends found
                  </div>
                ) : (
                  <UserList
                    items={filteredFriends}
                    getUser={(friend) => ({
                      id: friend.friend?.id || "",
                      firstName: friend.friend?.firstName || null,
                      lastName: friend.friend?.lastName || null,
                      username: friend.friend?.username || null,
                      avatarImageUrl: friend.friend?.avatarImageUrl || null,
                    })}
                  />
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            {!pendingRequests ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !hasAnyRequests ? (
              <>
                <StickySectionHeader className="-mx-4">
                  <h2 className="tracking-tight">Friend Requests</h2>
                </StickySectionHeader>
                <EmptyStateCard
                  icon={Mail}
                  title="No pending friend requests"
                />
              </>
            ) : normalizedRequestQuery &&
              filteredReceivedRequests.length === 0 &&
              filteredSentRequests.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="py-12 text-center text-muted-foreground">
                    No requests found
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <section>
                  <StickySectionHeader className="-mx-4">
                    <h2 className="tracking-tight">Received Requests</h2>
                  </StickySectionHeader>
                  <Card>
                    <CardContent className="pt-6">
                      {filteredReceivedRequests.length === 0 ? (
                        <EmptyStateCard
                          icon={Mail}
                          title={
                            normalizedRequestQuery
                              ? "No received requests found"
                              : "No pending friend requests"
                          }
                          showCard={false}
                        />
                      ) : (
                        <UserList
                          items={filteredReceivedRequests}
                          getUser={(req) => ({
                            id: req.friend?.id || "",
                            firstName: req.friend?.firstName || null,
                            lastName: req.friend?.lastName || null,
                            username: req.friend?.username || null,
                            avatarImageUrl: req.friend?.avatarImageUrl || null,
                          })}
                          renderAction={(request) => (
                            <div className="flex items-center gap-4">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => {
                                  sendGoogleAnalyticsEvent(
                                    "friend_request_responded",
                                    userId,
                                    {
                                      action: "rejected",
                                      friend_request_id: request.id,
                                      source: "friend_requests_page",
                                    }
                                  );
                                  rejectMutation.mutate({
                                    friendRequestId: request.id,
                                  });
                                }}
                                disabled={rejectMutation.isPending}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                              <Button
                                onClick={() => {
                                  sendGoogleAnalyticsEvent(
                                    "friend_request_responded",
                                    userId,
                                    {
                                      action: "accepted",
                                      friend_request_id: request.id,
                                      source: "friend_requests_page",
                                    }
                                  );
                                  acceptMutation.mutate({
                                    friendRequestId: request.id,
                                  });
                                }}
                                disabled={acceptMutation.isPending}
                              >
                                Accept
                              </Button>
                            </div>
                          )}
                        />
                      )}
                    </CardContent>
                  </Card>
                </section>

                {(filteredSentRequests.length > 0 ||
                  (!normalizedRequestQuery && sentRequests.length > 0)) && (
                  <section className="pt-4">
                    <StickySectionHeader className="-mx-4">
                      <h2 className="tracking-tight">Sent Requests</h2>
                    </StickySectionHeader>
                    <Card>
                      <CardContent className="pt-6">
                        {filteredSentRequests.length === 0 ? (
                          <div className="py-4 text-sm text-muted-foreground">
                            No sent requests found
                          </div>
                        ) : (
                          <UserList
                            items={filteredSentRequests}
                            getUser={(req) => ({
                              id: req.friend?.id || "",
                              firstName: req.friend?.firstName || null,
                              lastName: req.friend?.lastName || null,
                              username: req.friend?.username || null,
                              avatarImageUrl:
                                req.friend?.avatarImageUrl || null,
                            })}
                            renderBadges={() => (
                              <Badge variant="outline">Pending</Badge>
                            )}
                          />
                        )}
                      </CardContent>
                    </Card>
                  </section>
                )}
              </>
            )}
          </>
        )
      ) : isSearchMode ? (
        // Search Mode View
        <div>
          {isSearching ? (
            // Search Results
            <>
              {searchLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : sortedSearchResults.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  No users found
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {sortedSearchResults.length}{" "}
                    {pluralize("result", sortedSearchResults.length)}
                  </p>
                  <UserList
                    items={sortedSearchResults}
                    getUser={(user) => user}
                    renderBadges={(user) =>
                      isFriend(user.id) ? (
                        <Badge variant="secondary" className="text-xs">
                          Friend
                        </Badge>
                      ) : null
                    }
                    renderAction={(user) =>
                      isAlreadyAdded(user.id) ? (
                        <Button size="sm" disabled variant="outline">
                          Added
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => {
                            sendGoogleAnalyticsEvent(
                              "friend_request_sent",
                              userId,
                              {
                                target_user_id: user.id,
                                source: "friends_search_results",
                              }
                            );
                            sendRequestMutation.mutate({
                              friendUserId: user.id,
                            });
                          }}
                          disabled={sendRequestMutation.isPending}
                        >
                          <UserPlus className="mr-2 h-4 w-4" />
                          Add
                        </Button>
                      )
                    }
                  />
                </>
              )}
            </>
          ) : (
            // Recent Users (when focused but no query)
            renderRecentlyJoined()
          )}
        </div>
      ) : (
        // Default View
        <>
          {/* Pending Requests Preview */}
          {receivedRequests.length > 0 && (
            <div>
              <div className="flex items-center justify-between">
                <h2 className={"text-xl font-semibold"}>Friend Requests</h2>
              </div>
              <div>
                <UserList
                  items={receivedRequests.slice(0, 3)}
                  getUser={(req) => ({
                    id: req.friend?.id || "",
                    firstName: req.friend?.firstName || null,
                    lastName: req.friend?.lastName || null,
                    username: req.friend?.username || null,
                    avatarImageUrl: req.friend?.avatarImageUrl || null,
                  })}
                  renderAction={(request) => (
                    <div className="flex items-center gap-4">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => {
                          sendGoogleAnalyticsEvent(
                            "friend_request_responded",
                            userId,
                            {
                              action: "rejected",
                              friend_request_id: request.id,
                              source: "friends_page_preview",
                            }
                          );
                          rejectMutation.mutate({
                            friendRequestId: request.id,
                          });
                        }}
                        disabled={rejectMutation.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => {
                          sendGoogleAnalyticsEvent(
                            "friend_request_responded",
                            userId,
                            {
                              action: "accepted",
                              friend_request_id: request.id,
                              source: "friends_page_preview",
                            }
                          );
                          acceptMutation.mutate({
                            friendRequestId: request.id,
                          });
                        }}
                        disabled={acceptMutation.isPending}
                      >
                        Accept
                      </Button>
                    </div>
                  )}
                />
              </div>
            </div>
          )}

          {/* Activity Feed */}
          {friendsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : acceptedFriends.length === 0 ? (
            renderRecentlyJoined()
          ) : (
            <div>
              <div className="md:hidden">
                <ActivityFeed eventTiming={activityTiming} />
              </div>
              <div className="hidden md:block">
                <ActivityFeed groupByRecency groupHeaderClassName="-mx-4" />
              </div>
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}

export default function FriendsPage() {
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
      <FriendsPageContent />
    </Suspense>
  );
}
