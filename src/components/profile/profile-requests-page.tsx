"use client";

import { useState } from "react";
import { Check, Loader2, Mail, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import { PageContainer } from "@/components/shared/page-container";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { UserList } from "@/components/user-list";
import { useToast } from "@/hooks/use-toast";
import { MobileFilterPills } from "@/components/ui/mobile-filter-pills";
import {
  MobileProfileEmpty,
  MobileProfileListHeader,
  MobileProfileUserRow,
} from "@/components/profile/mobile-profile-list";

export function ProfileRequestsPage() {
  const [mobileFilter, setMobileFilter] = useState<"received" | "sent">(
    "received"
  );
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { data: pendingRequests, isLoading } =
    trpc.friends.listFriends.useQuery({
      statusFilter: "pending",
    });

  const acceptMutation = trpc.friends.acceptFriendRequest.useMutation({
    onSuccess: () => {
      utils.friends.listFriends.invalidate();
      utils.friends.getPendingRequests.invalidate();
      utils.user.getProfileByUsername.invalidate();
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
      utils.friends.listFriends.invalidate();
      utils.friends.getPendingRequests.invalidate();
      utils.user.getProfileByUsername.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sentRequests =
    pendingRequests?.filter((request) => request.isSender) || [];
  const receivedRequests =
    pendingRequests?.filter((request) => !request.isSender) || [];
  const hasAnyRequests = receivedRequests.length > 0 || sentRequests.length > 0;

  return (
    <PageContainer className="min-h-screen max-w-5xl bg-black !px-2 !pt-0 md:!px-6 md:!pt-8">
      <div className="md:hidden">
        <MobileProfileListHeader title="Requests" />
        <MobileFilterPills
          options={[
            { value: "received", label: "Requests" },
            { value: "sent", label: `Sent (${sentRequests.length})` },
          ]}
          value={mobileFilter}
          onValueChange={setMobileFilter}
          className="mt-4"
        />

        <div className="mt-4">
          {mobileFilter === "received" ? (
            receivedRequests.length ? (
              receivedRequests.map((request) => {
                const friend = request.friend;
                if (!friend) return null;
                return (
                  <MobileProfileUserRow
                    key={request.id}
                    user={friend}
                    action={
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label="Decline friend request"
                          onClick={() =>
                            rejectMutation.mutate({
                              friendRequestId: request.id,
                            })
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07]"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Accept friend request"
                          onClick={() =>
                            acceptMutation.mutate({
                              friendRequestId: request.id,
                            })
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-300 text-black"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      </div>
                    }
                  />
                );
              })
            ) : (
              <MobileProfileEmpty>
                No pending friend requests
              </MobileProfileEmpty>
            )
          ) : sentRequests.length ? (
            sentRequests.map((request) =>
              request.friend ? (
                <MobileProfileUserRow
                  key={request.id}
                  user={request.friend}
                  action={
                    <span className="text-[10px] font-medium text-white/45">
                      Pending
                    </span>
                  }
                />
              ) : null
            )
          ) : (
            <MobileProfileEmpty>No sent requests</MobileProfileEmpty>
          )}
        </div>
      </div>

      <div className="hidden md:block">
        <BackButtonHeader backHref="/profile" title="Friend Requests" />

        {!hasAnyRequests ? (
          <EmptyStateCard icon={Mail} title="No pending friend requests" />
        ) : (
          <>
            <section>
              <StickySectionHeader className="-mx-4">
                <h2 className="tracking-tight">Received Requests</h2>
              </StickySectionHeader>
              <Card>
                <CardContent className="pt-6">
                  {receivedRequests.length === 0 ? (
                    <EmptyStateCard
                      icon={Mail}
                      title="No pending friend requests"
                      showCard={false}
                    />
                  ) : (
                    <UserList
                      items={receivedRequests}
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
                  )}
                </CardContent>
              </Card>
            </section>

            {sentRequests.length > 0 ? (
              <section className="pt-4">
                <StickySectionHeader className="-mx-4">
                  <h2 className="tracking-tight">Sent Requests</h2>
                </StickySectionHeader>
                <Card>
                  <CardContent className="pt-6">
                    <UserList
                      items={sentRequests}
                      getUser={(req) => ({
                        id: req.friend?.id || "",
                        firstName: req.friend?.firstName || null,
                        lastName: req.friend?.lastName || null,
                        username: req.friend?.username || null,
                        avatarImageUrl: req.friend?.avatarImageUrl || null,
                      })}
                      renderBadges={() => (
                        <Badge variant="outline">Pending</Badge>
                      )}
                    />
                  </CardContent>
                </Card>
              </section>
            ) : null}
          </>
        )}
      </div>
    </PageContainer>
  );
}
