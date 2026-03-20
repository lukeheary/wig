"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import Link from "next/link";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { buildReturnTo, withReturnTo } from "@/lib/navigation";
import { useAuth } from "@clerk/nextjs";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";

export function NotificationsBell() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDesktopOpen, setIsDesktopOpen] = useState(false);
  const { userId } = useAuth();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { data: pendingFriendRequests } =
    trpc.friends.getPendingRequests.useQuery();
  const { data: pendingPartnerRequests } =
    trpc.partners.getPendingPartnerRequests.useQuery();
  const { data: recentNotifications } =
    trpc.notifications.listRecent.useQuery();
  const { data: unreadNotificationsCountData } =
    trpc.notifications.getUnreadCount.useQuery();

  const markNotificationsReadMutation =
    trpc.notifications.markAllRead.useMutation({
      onSuccess: async () => {
        await Promise.all([
          utils.notifications.listRecent.invalidate(),
          utils.notifications.listUnread.invalidate(),
          utils.notifications.getUnreadCount.invalidate(),
        ]);
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
    onSuccess: async () => {
      toast({
        title: "Friend request accepted",
        description: "You are now friends!",
      });
      await Promise.all([
        utils.notifications.listRecent.invalidate(),
        utils.notifications.listUnread.invalidate(),
        utils.notifications.getUnreadCount.invalidate(),
        utils.friends.getPendingRequests.invalidate(),
        utils.friends.listFriends.invalidate(),
      ]);
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
    onSuccess: async () => {
      toast({
        title: "Friend request rejected",
      });
      await Promise.all([
        utils.notifications.listRecent.invalidate(),
        utils.notifications.listUnread.invalidate(),
        utils.notifications.getUnreadCount.invalidate(),
        utils.friends.getPendingRequests.invalidate(),
      ]);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const acceptPartnerMutation = trpc.partners.acceptPartnerRequest.useMutation({
    onSuccess: async () => {
      toast({
        title: "Partner request accepted",
        description: "You are now partners!",
      });
      await Promise.all([
        utils.notifications.listRecent.invalidate(),
        utils.notifications.listUnread.invalidate(),
        utils.notifications.getUnreadCount.invalidate(),
        utils.partners.getMyPartner.invalidate(),
        utils.partners.getPendingPartnerRequests.invalidate(),
        utils.friends.listFriends.invalidate(),
      ]);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const declinePartnerMutation =
    trpc.partners.declinePartnerRequest.useMutation({
      onSuccess: async () => {
        toast({
          title: "Partner request declined",
        });
        await Promise.all([
          utils.notifications.listRecent.invalidate(),
          utils.notifications.listUnread.invalidate(),
          utils.notifications.getUnreadCount.invalidate(),
          utils.partners.getMyPartner.invalidate(),
          utils.partners.getPendingPartnerRequests.invalidate(),
        ]);
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  const unreadNotificationsCount =
    unreadNotificationsCountData?.unreadCount ?? 0;
  const notifications = recentNotifications ?? [];
  const requestNotificationIds = new Set(
    notifications
      .filter(
        (notification) =>
          isFriendRequestNotification(notification) ||
          isPartnerRequestNotification(notification)
      )
      .map((notification) => notification.entityId)
  );
  const fallbackFriendRequests = (pendingFriendRequests ?? []).filter(
    (request) => !requestNotificationIds.has(request.id)
  );
  const fallbackPartnerRequests = (pendingPartnerRequests ?? []).filter(
    (request) => !requestNotificationIds.has(request.id)
  );
  const newNotifications = notifications.filter(
    (notification) => !notification.readAt
  );
  const oldNotifications = notifications.filter((notification) =>
    Boolean(notification.readAt)
  );
  const notificationCount =
    unreadNotificationsCount +
    fallbackFriendRequests.length +
    fallbackPartnerRequests.length;
  const hasInboxItems =
    newNotifications.length > 0 ||
    oldNotifications.length > 0 ||
    fallbackFriendRequests.length > 0 ||
    fallbackPartnerRequests.length > 0;
  const returnTo = buildReturnTo(pathname, searchParams);

  const markNotificationsReadIfNeeded = () => {
    if (
      unreadNotificationsCount > 0 &&
      !markNotificationsReadMutation.isPending
    ) {
      markNotificationsReadMutation.mutate();
    }
  };

  const handleMobileOpenChange = (open: boolean) => {
    if (!open && isMobileOpen) {
      markNotificationsReadIfNeeded();
    }
    setIsMobileOpen(open);
  };

  const handleDesktopOpenChange = (open: boolean) => {
    if (!open && isDesktopOpen) {
      markNotificationsReadIfNeeded();
    }
    setIsDesktopOpen(open);
  };

  const closeNotifications = () => {
    markNotificationsReadIfNeeded();
    setIsMobileOpen(false);
    setIsDesktopOpen(false);
  };

  const extractEventTitleFromBody = (body: string) => {
    const patterns = [
      /^(.*?\b(?:created|updated|cancelled|postponed|rescheduled|restored)\b )(.+)$/,
      /^(.*?\bRSVP'd going to\b )(.+?)( for both of you)?$/,
      /^(.*?\bRSVP'd interested in\b )(.+?)( for both of you)?$/,
    ];

    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) {
        return {
          prefix: match[1] ?? "",
          eventTitle: match[2] ?? body,
          suffix: match[3] ?? "",
        };
      }
    }

    return null;
  };

  const renderNotificationBody = (notification: {
    body: string | null;
    entityType: string;
    actionUrl: string | null;
    metadata: unknown;
  }, options?: {
    className?: string;
  }) => {
    const bodyClassName = options?.className ?? "mt-1 text-sm text-muted-foreground";

    if (!notification.body) {
      return null;
    }

    if (notification.entityType === "event") {
      const metadata =
        (notification.metadata as { eventTitle?: string } | null) ?? null;
      const parsedBody = extractEventTitleFromBody(notification.body);
      const eventTitle = metadata?.eventTitle || parsedBody?.eventTitle;
      const prefix = parsedBody?.prefix ?? "";
      const suffix = parsedBody?.suffix ?? "";

      if (!eventTitle) {
        return (
          <p className={bodyClassName}>
            <Link
              href={withReturnTo(notification.actionUrl || "/home", returnTo)}
              className="hover:underline"
              onClick={closeNotifications}
            >
              {notification.body}
            </Link>
          </p>
        );
      }

      return (
        <p className={bodyClassName}>
          {prefix}
          <Link
            href={withReturnTo(notification.actionUrl || "/home", returnTo)}
            className="hover:underline"
            onClick={closeNotifications}
          >
            {eventTitle}
          </Link>
          {suffix}
        </p>
      );
    }

    return (
      <p className={bodyClassName}>{notification.body}</p>
    );
  };

  function isFriendRequestNotification(notification: {
    type: string;
    entityType: string;
  }) {
    return (
      notification.type === "friend_request" &&
      notification.entityType === "friend_request"
    );
  }

  function isPartnerRequestNotification(notification: {
    type: string;
    entityType: string;
  }) {
    return (
      notification.type === "partner_request" &&
      notification.entityType === "partner_request"
    );
  }

  const renderNotificationActions = (notification: {
    id: string;
    entityId: string;
    type: string;
    entityType: string;
  }) => {
    if (isFriendRequestNotification(notification)) {
      return (
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 text-xs"
            onClick={() => {
              sendGoogleAnalyticsEvent("friend_request_responded", userId, {
                action: "rejected",
                friend_request_id: notification.entityId,
                source: "notifications_bell",
              });
              rejectMutation.mutate({
                friendRequestId: notification.entityId,
              });
            }}
            disabled={
              acceptMutation.isPending ||
              rejectMutation.isPending ||
              acceptPartnerMutation.isPending ||
              declinePartnerMutation.isPending
            }
          >
            <X className="mr-1 h-3 w-3" />
            Reject
          </Button>
          <Button
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={() => {
              sendGoogleAnalyticsEvent("friend_request_responded", userId, {
                action: "accepted",
                friend_request_id: notification.entityId,
                source: "notifications_bell",
              });
              acceptMutation.mutate({
                friendRequestId: notification.entityId,
              });
            }}
            disabled={
              acceptMutation.isPending ||
              rejectMutation.isPending ||
              acceptPartnerMutation.isPending ||
              declinePartnerMutation.isPending
            }
          >
            <Check className="mr-1 h-3 w-3" />
            Accept
          </Button>
        </div>
      );
    }

    if (isPartnerRequestNotification(notification)) {
      return (
        <div className="flex items-center gap-2 pt-0.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 text-xs"
            onClick={() =>
              declinePartnerMutation.mutate({
                partnerId: notification.entityId,
              })
            }
            disabled={
              acceptMutation.isPending ||
              rejectMutation.isPending ||
              acceptPartnerMutation.isPending ||
              declinePartnerMutation.isPending
            }
          >
            <X className="mr-1 h-3 w-3" />
            Decline
          </Button>
          <Button
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={() =>
              acceptPartnerMutation.mutate({
                partnerId: notification.entityId,
              })
            }
            disabled={
              acceptMutation.isPending ||
              rejectMutation.isPending ||
              acceptPartnerMutation.isPending ||
              declinePartnerMutation.isPending
            }
          >
            <Check className="mr-1 h-3 w-3" />
            Accept
          </Button>
        </div>
      );
    }

    return null;
  };

  const renderNotificationLink = (notification: {
    title: string;
    actionUrl: string | null;
    type: string;
    entityType: string;
  }) => {
    const isActionableRequest =
      isFriendRequestNotification(notification) ||
      isPartnerRequestNotification(notification);

    if (!notification.actionUrl || isActionableRequest) {
      return <span className="font-semibold">{notification.title}</span>;
    }

    return (
      <Link
        href={withReturnTo(notification.actionUrl, returnTo)}
        className="hover:underline"
        onClick={closeNotifications}
      >
        <span className="font-semibold">{notification.title}</span>
      </Link>
    );
  };

  const shouldShowTitleAboveAvatar = (notification: {
    type: string;
    entityType: string;
  }) =>
    isFriendRequestNotification(notification) ||
    isPartnerRequestNotification(notification);

  const formatNotificationTime = (createdAt: Date | string) =>
    formatDistanceToNow(new Date(createdAt), {
      addSuffix: true,
    });

  const NotificationsContent = (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <h4 className="text-xl font-semibold leading-tight">Notifications</h4>
        {/*{hasNotifications && (*/}
        {/*  <span className="text-sm font-medium text-muted-foreground">*/}
        {/*    {pendingRequests!.length} new*/}
        {/*  </span>*/}
        {/*)}*/}
      </div>

      {!hasInboxItems ? (
        <div className="rounded-lg border border-border/60 bg-muted/40 py-8 text-center text-sm text-muted-foreground">
          No new notifications
        </div>
      ) : (
        <div className="max-h-[400px] space-y-2.5 overflow-y-auto pr-1">
          {newNotifications.length > 0 && (
            <div className="space-y-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                New
              </p>
              {fallbackFriendRequests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-xl border border-border/60 bg-muted/40 p-3 shadow-sm transition-colors hover:bg-muted/60"
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <UserAvatar
                          src={request.user.avatarImageUrl}
                          name={request.user.firstName}
                          className="h-7 w-7"
                        />
                        <p className="text-sm leading-snug text-muted-foreground">
                          {request.user.firstName} {request.user.lastName} sent
                          you a friend request
                        </p>
                      </div>
                      <p className="shrink-0 text-xs text-muted-foreground">
                        {formatNotificationTime(request.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 flex-1 text-xs"
                        onClick={() => {
                          sendGoogleAnalyticsEvent(
                            "friend_request_responded",
                            userId,
                            {
                              action: "rejected",
                              friend_request_id: request.id,
                              source: "notifications_bell",
                            }
                          );
                          rejectMutation.mutate({
                            friendRequestId: request.id,
                          });
                        }}
                        disabled={
                          acceptMutation.isPending ||
                          rejectMutation.isPending ||
                          acceptPartnerMutation.isPending ||
                          declinePartnerMutation.isPending
                        }
                      >
                        <X className="mr-1 h-3 w-3" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 flex-1 text-xs"
                        onClick={() => {
                          sendGoogleAnalyticsEvent(
                            "friend_request_responded",
                            userId,
                            {
                              action: "accepted",
                              friend_request_id: request.id,
                              source: "notifications_bell",
                            }
                          );
                          acceptMutation.mutate({
                            friendRequestId: request.id,
                          });
                        }}
                        disabled={
                          acceptMutation.isPending ||
                          rejectMutation.isPending ||
                          acceptPartnerMutation.isPending ||
                          declinePartnerMutation.isPending
                        }
                      >
                        <Check className="mr-1 h-3 w-3" />
                        Accept
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {fallbackPartnerRequests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-xl border border-border/60 bg-muted/40 p-3 shadow-sm transition-colors hover:bg-muted/60"
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <UserAvatar
                          src={request.partner?.avatarImageUrl}
                          name={request.partner?.firstName}
                          className="h-7 w-7"
                        />
                        <p className="text-sm leading-snug text-muted-foreground">
                          {request.partner?.firstName}{" "}
                          {request.partner?.lastName} wants to be your partner
                        </p>
                      </div>
                      <p className="shrink-0 text-xs text-muted-foreground">
                        {formatNotificationTime(request.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-0.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 flex-1 text-xs"
                        onClick={() =>
                          declinePartnerMutation.mutate({
                            partnerId: request.id,
                          })
                        }
                        disabled={
                          acceptMutation.isPending ||
                          rejectMutation.isPending ||
                          acceptPartnerMutation.isPending ||
                          declinePartnerMutation.isPending
                        }
                      >
                        <X className="mr-1 h-3 w-3" />
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 flex-1 text-xs"
                        onClick={() =>
                          acceptPartnerMutation.mutate({
                            partnerId: request.id,
                          })
                        }
                        disabled={
                          acceptMutation.isPending ||
                          rejectMutation.isPending ||
                          acceptPartnerMutation.isPending ||
                          declinePartnerMutation.isPending
                        }
                      >
                        <Check className="mr-1 h-3 w-3" />
                        Accept
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {newNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className="rounded-xl border border-border/60 bg-muted/40 p-3 shadow-sm transition-colors hover:bg-muted/60"
                >
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <p className="text-sm leading-snug">
                      {renderNotificationLink(notification)}
                    </p>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {formatNotificationTime(notification.createdAt)}
                    </p>
                  </div>
                  {notification.actor ? (
                    <div className="flex items-start gap-2.5">
                      <UserAvatar
                        src={notification.actor.avatarImageUrl}
                        name={notification.actor.firstName}
                        className="h-7 w-7"
                      />
                      {renderNotificationBody(notification, {
                        className: "text-sm leading-snug text-muted-foreground",
                      })}
                    </div>
                  ) : (
                    renderNotificationBody(notification, {
                      className: "text-sm leading-snug text-muted-foreground",
                    })
                  )}
                  {renderNotificationActions(notification)}
                </div>
              ))}
            </div>
          )}

          {(newNotifications.length > 0 ||
            fallbackFriendRequests.length > 0 ||
            fallbackPartnerRequests.length > 0) &&
            oldNotifications.length > 0 && (
              <div className="border-t border-border/60" />
            )}

          {oldNotifications.length > 0 && (
            <div className="space-y-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Old
              </p>
              {oldNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className="rounded-xl border border-border/60 bg-muted/40 p-3 shadow-sm transition-colors hover:bg-muted/60"
                >
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <p className="text-sm leading-snug">
                      {renderNotificationLink(notification)}
                    </p>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {formatNotificationTime(notification.createdAt)}
                    </p>
                  </div>
                  {notification.actor ? (
                    <div className="flex items-start gap-2.5">
                      <UserAvatar
                        src={notification.actor.avatarImageUrl}
                        name={notification.actor.firstName}
                        className="h-7 w-7"
                      />
                      {renderNotificationBody(notification, {
                        className: "text-sm leading-snug text-muted-foreground",
                      })}
                    </div>
                  ) : (
                    renderNotificationBody(notification, {
                      className: "text-sm leading-snug text-muted-foreground",
                    })
                  )}
                  {renderNotificationActions(notification)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="md:hidden">
        <Sheet open={isMobileOpen} onOpenChange={handleMobileOpenChange}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {notificationCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  {notificationCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="top" className="max-h-[80vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="sr-only">Notifications</SheetTitle>
            </SheetHeader>
            {NotificationsContent}
          </SheetContent>
        </Sheet>
      </div>

      <div className="hidden md:block">
        <Popover open={isDesktopOpen} onOpenChange={handleDesktopOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative ml-2 md:ml-0"
            >
              <Bell className="h-5 w-5" />
              {notificationCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neon-teal text-[10px] font-semibold text-primary-foreground">
                  {notificationCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            {NotificationsContent}
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
