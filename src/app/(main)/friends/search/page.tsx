"use client";

import { Suspense, useState } from "react";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryState } from "nuqs";
import { useAuth } from "@clerk/nextjs";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";
import { BackButtonHeader } from "@/components/shared/back-button-header";

function SearchPageContent() {
  const { toast } = useToast();
  const { userId } = useAuth();
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useQueryState("q", {
    defaultValue: "",
  });
  const [cursor, setCursor] = useState(0);
  const pageSize = 20;

  const { data: searchResults, isLoading: searchLoading } =
    trpc.friends.searchUsers.useQuery(
      { query: searchQuery, limit: 20 },
      { enabled: searchQuery.length >= 2 }
    );

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
  const isAlreadyAdded = (targetUserId: string) => relatedUserIds.has(targetUserId);

  return (
    <div className="container mx-auto space-y-4 pb-4">
      <BackButtonHeader
        backHref="/friends"
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
                      sendGoogleAnalyticsEvent("friend_request_sent", userId, {
                        target_user_id: user.id,
                        source: "friend_search_page_results",
                      });
                      sendRequestMutation.mutate({ friendUserId: user.id });
                    }}
                    disabled={sendRequestMutation.isPending || isAlreadyAdded(user.id)}
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
                              source: "friend_search_page_recent",
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
