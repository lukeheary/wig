"use client";

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { SearchInput } from "@/components/ui/search-input";
import { useNavbarSearch } from "@/contexts/nav-search-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, UserPlus, X } from "lucide-react";
import { ActivityFeed } from "@/components/friends/activity-feed";
import { useToast } from "@/hooks/use-toast";
import { useQueryState } from "nuqs";
import pluralize from "pluralize";
import { UserList } from "@/components/user-list";
import { StickySearchBar } from "@/components/ui/sticky-search-bar";

function FriendsPageContent() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [isSticky, setIsSticky] = useState(false);
  const { setShowNavbarSearch, registerScrollToSearch } = useNavbarSearch();
  const [searchQuery, setSearchQuery] = useQueryState("q", {
    defaultValue: "",
  });

  // Scroll to top and focus search input when navbar search button is clicked
  const scrollToSearchAndFocus = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
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
  const { data: friends } = trpc.friends.listFriends.useQuery({});
  const { data: pendingRequests } = trpc.friends.listFriends.useQuery({
    statusFilter: "pending",
  });

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
      { enabled: isSearchMode && searchQuery.length < 2 }
    );

  const acceptedFriends = friends?.filter((f) => f.status === "accepted") || [];
  const receivedRequests = pendingRequests?.filter((f) => !f.isSender) || [];

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

  const isSearching = searchQuery.length >= 2;

  return (
    <div className="container mx-auto pb-8 pt-4">
      {/* Sticky sentinel for intersection observer */}
      <div ref={stickySentinelRef} className="h-px w-full" />

      <StickySearchBar>
        <Suspense fallback={null}>
          <SearchInput
            ref={searchInputRef}
            placeholder="Search friends or find new people..."
            value={searchQuery}
            onChange={setSearchQuery}
            onFocus={() => setIsSearchMode(true)}
            showBack={isSearchMode}
            onBack={handleExitSearch}
            className="w-full"
          />
        </Suspense>

        {!isSearchMode && (
          <div className="flex w-full shrink-0 gap-2 sm:w-auto">
            <Link
              href="/friends/list"
              className="flex-1 sm:w-32 sm:flex-none lg:w-40"
            >
              <div className="flex h-12 cursor-pointer items-center justify-between rounded-full bg-muted px-4 transition-colors hover:bg-muted/80">
                <p className="flex flex-row items-center gap-1.5 text-base font-medium lg:text-lg">
                  <span>{acceptedFriends.length}</span>
                  <span className={"text-sm text-muted-foreground"}>
                    {pluralize("Friend", acceptedFriends.length)}
                  </span>
                </p>
                <ChevronRight className="h-4 w-4 text-muted-foreground lg:h-5 lg:w-5" />
              </div>
            </Link>
            <Link
              href="/friends/requests"
              className="flex-1 sm:w-32 sm:flex-none lg:w-40"
            >
              <div className="flex h-12 cursor-pointer items-center justify-between rounded-full bg-muted px-4 transition-colors hover:bg-muted/80">
                <p className="flex flex-row items-center gap-1.5 text-base font-medium lg:text-lg">
                  <span>{receivedRequests.length}</span>
                  <span className={"text-sm text-muted-foreground"}>
                    {pluralize("Request", receivedRequests.length)}
                  </span>
                </p>
                <ChevronRight className="h-4 w-4 text-muted-foreground lg:h-5 lg:w-5" />
              </div>
            </Link>
          </div>
        )}
      </StickySearchBar>

      {isSearchMode ? (
        // Search Mode View
        <div className="space-y-3">
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
                      !isFriend(user.id) ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            sendRequestMutation.mutate({
                              friendUserId: user.id,
                            })
                          }
                          disabled={sendRequestMutation.isPending}
                        >
                          <UserPlus className="mr-2 h-4 w-4" />
                          Add
                        </Button>
                      ) : null
                    }
                  />
                </>
              )}
            </>
          ) : (
            // Recent Users (when focused but no query)
            <>
              <div className={"pt-4"}>
                <h2 className="text-xl font-semibold">Recently Joined</h2>
              </div>
              {recentLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !recentUsers?.items || recentUsers.items.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  No recent members to show
                </div>
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
                    !isFriend(user.id) ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          sendRequestMutation.mutate({ friendUserId: user.id })
                        }
                        disabled={sendRequestMutation.isPending}
                      >
                        <UserPlus className="mr-2 h-4 w-4" />
                        Add
                      </Button>
                    ) : null
                  }
                />
              )}
            </>
          )}
        </div>
      ) : (
        // Default View
        <>
          {/* Pending Requests Preview */}
          {receivedRequests.length > 0 && (
            <div className={"mt-4"}>
              <div className="flex items-center justify-between">
                <h2 className={"text-xl font-semibold"}>Friend Requests</h2>
              </div>
              <div className="space-y-3">
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
                        onClick={() =>
                          rejectMutation.mutate({
                            friendRequestId: request.id,
                          })
                        }
                        disabled={rejectMutation.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() =>
                          acceptMutation.mutate({
                            friendRequestId: request.id,
                          })
                        }
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
          <div>
            <ActivityFeed groupByRecency groupHeaderClassName="-mx-4" />
          </div>
        </>
      )}
    </div>
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
