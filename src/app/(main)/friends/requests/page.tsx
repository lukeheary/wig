"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Mail, Loader2, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { UserList } from "@/components/user-list";
import { useAuth } from "@clerk/nextjs";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";
import { Card, CardContent } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { StickySearchBar } from "@/components/ui/sticky-search-bar";
import pluralize from "pluralize";

function RequestsPageContent() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  const { userId } = useAuth();
  const utils = trpc.useUtils();

  const { data: pendingRequests, isLoading } =
    trpc.friends.listFriends.useQuery({
      statusFilter: "pending",
    });
  const { data: allFriends } = trpc.friends.listFriends.useQuery({});

  const acceptMutation = trpc.friends.acceptFriendRequest.useMutation({
    onSuccess: () => {
      toast({
        title: "Friend request accepted",
        description: "You are now friends",
      });
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
      // toast({
      //   title: "Friend request rejected",
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

  const sentRequests = pendingRequests?.filter((f) => f.isSender) || [];
  const receivedRequests = pendingRequests?.filter((f) => !f.isSender) || [];
  const acceptedFriends =
    allFriends?.filter((f) => f.status === "accepted") || [];
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchesQuery = (request: (typeof sentRequests)[number]) => {
    if (!normalizedQuery) return true;

    const firstName = request.friend?.firstName?.toLowerCase() ?? "";
    const lastName = request.friend?.lastName?.toLowerCase() ?? "";
    const username = request.friend?.username?.toLowerCase() ?? "";
    const fullName = `${firstName} ${lastName}`.trim();

    return (
      fullName.includes(normalizedQuery) ||
      firstName.includes(normalizedQuery) ||
      lastName.includes(normalizedQuery) ||
      username.includes(normalizedQuery)
    );
  };
  const filteredReceivedRequests = useMemo(
    () => receivedRequests.filter(matchesQuery),
    [receivedRequests, normalizedQuery]
  );
  const filteredSentRequests = useMemo(
    () => sentRequests.filter(matchesQuery),
    [sentRequests, normalizedQuery]
  );
  const hasAnyRequests = receivedRequests.length > 0 || sentRequests.length > 0;

  return (
    <div className="container mx-auto pb-8 pt-4">
      <div className="h-px w-full" />

      <StickySearchBar>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search requests..."
          showBack
          onBack={() => router.push("/friends")}
          className="w-full"
        />

        <div className="flex w-full shrink-0 gap-2 sm:w-auto">
          <Link
            href="/friends/list"
            className="flex-1 sm:w-32 sm:flex-none lg:w-40"
          >
            <div className="flex h-12 cursor-pointer items-center justify-between rounded-full bg-muted px-5 transition-colors hover:bg-muted/80">
              <p className="flex flex-row items-center gap-1.5 text-base font-medium lg:text-lg">
                <span>{acceptedFriends.length}</span>
                <span className="text-sm text-muted-foreground">
                  {pluralize("Friend", acceptedFriends.length)}
                </span>
              </p>
              <ChevronRight className="h-4 w-4 text-muted-foreground lg:h-5 lg:w-5" />
            </div>
          </Link>
          <div className="flex-1 sm:w-32 sm:flex-none lg:w-40">
            <div className="flex h-12 items-center justify-between rounded-full bg-muted px-5">
              <p className="flex flex-row items-center gap-1.5 text-base font-medium lg:text-lg">
                <span>{receivedRequests.length}</span>
                <span className="text-sm text-muted-foreground">
                  {pluralize("Request", receivedRequests.length)}
                </span>
              </p>
            </div>
          </div>
        </div>
      </StickySearchBar>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !hasAnyRequests ? (
        <Card>
          <CardContent className="pt-6">
            <div className="py-8 text-center">
              <Mail className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">
                No pending friend requests
              </p>
            </div>
          </CardContent>
        </Card>
      ) : normalizedQuery &&
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
              <h2 className="text-xl font-semibold tracking-tight">
                Received Requests
              </h2>
            </StickySectionHeader>
            <Card>
              <CardContent className="pt-6">
                {filteredReceivedRequests.length === 0 ? (
                  <div className="py-8 text-center">
                    <Mail className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      {normalizedQuery
                        ? "No received requests found"
                        : "No pending friend requests"}
                    </p>
                  </div>
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
            (!normalizedQuery && sentRequests.length > 0)) && (
            <section className={"pt-4"}>
              <StickySectionHeader className="-mx-4">
                <h2 className="text-xl font-semibold tracking-tight">
                  Sent Requests
                </h2>
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
                        avatarImageUrl: req.friend?.avatarImageUrl || null,
                      })}
                      renderAction={() => (
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
    </div>
  );
}

export default function RequestsPage() {
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
      <RequestsPageContent />
    </Suspense>
  );
}
