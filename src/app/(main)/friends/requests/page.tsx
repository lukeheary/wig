"use client";

import { Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Mail, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { UserList } from "@/components/user-list";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { useAuth } from "@clerk/nextjs";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";

function RequestsPageContent() {
  const { toast } = useToast();
  const { userId } = useAuth();
  const utils = trpc.useUtils();

  const { data: pendingRequests, isLoading } =
    trpc.friends.listFriends.useQuery({
      statusFilter: "pending",
    });

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

  return (
    <div className="container mx-auto space-y-6 py-8">
      <BackButtonHeader backHref="/friends" title="Friend Requests" />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Received Requests */}
          <div className="space-y-3">
            {receivedRequests.length === 0 ? (
              <div className="py-8 text-center">
                <Mail className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No pending friend requests
                </p>
              </div>
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
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
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
                      <X className="mr-1 h-4 w-4" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
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
                      <Check className="mr-1 h-4 w-4" />
                      Accept
                    </Button>
                  </div>
                )}
              />
            )}
          </div>

          {/* Sent Requests */}
          {sentRequests.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Sent Requests</h2>
              <UserList
                items={sentRequests}
                getUser={(req) => ({
                  id: req.friend?.id || "",
                  firstName: req.friend?.firstName || null,
                  lastName: req.friend?.lastName || null,
                  username: req.friend?.username || null,
                  avatarImageUrl: req.friend?.avatarImageUrl || null,
                })}
                renderAction={() => <Badge variant="outline">Pending</Badge>}
              />
            </div>
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
