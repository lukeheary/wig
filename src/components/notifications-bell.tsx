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
  const { data: pendingRequests, refetch } =
    trpc.friends.getPendingRequests.useQuery();
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
    onSuccess: () => {
      toast({
        title: "Friend request accepted",
        description: "You are now friends!",
      });
      refetch();
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
      toast({
        title: "Friend request rejected",
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const pendingCount = pendingRequests?.length ?? 0;
  const unreadNotificationsCount =
    unreadNotificationsCountData?.unreadCount ?? 0;
  const eventNotifications =
    recentNotifications?.filter(
      (notification) => notification.type === "event_update"
    ) ?? [];
  const supportTicketNotifications =
    recentNotifications?.filter(
      (notification) => notification.type === "support_ticket_status_changed"
    ) ?? [];
  const notificationCount = pendingCount + unreadNotificationsCount;
  const hasNotifications = notificationCount > 0;
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

  const NotificationsContent = (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h4 className="text-xl font-semibold leading-tight">Notifications</h4>
        {/*{hasNotifications && (*/}
        {/*  <span className="text-sm font-medium text-muted-foreground">*/}
        {/*    {pendingRequests!.length} new*/}
        {/*  </span>*/}
        {/*)}*/}
      </div>

      {!hasNotifications ? (
        <div className="rounded-lg border border-border/60 bg-muted/40 py-8 text-center text-sm text-muted-foreground">
          No new notifications
        </div>
      ) : (
        <div className="max-h-[400px] space-y-3 overflow-y-auto pr-1">
          {eventNotifications.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Event updates
              </p>
              {eventNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className="rounded-xl border border-border/60 bg-muted/40 p-4 shadow-sm transition-colors hover:bg-muted/60"
                >
                  <p className="text-sm leading-snug">
                    <Link
                      href={withReturnTo(
                        notification.actionUrl || "/home",
                        returnTo
                      )}
                      className="hover:underline"
                    >
                      <span className="font-semibold">{notification.title}</span>
                    </Link>
                  </p>
                  {notification.body && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {notification.body}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(notification.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}

          {eventNotifications.length > 0 &&
            supportTicketNotifications.length > 0 && (
              <div className="border-t border-border/60" />
            )}

          {supportTicketNotifications.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Support tickets
              </p>
              {supportTicketNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className="rounded-xl border border-border/60 bg-muted/40 p-4 shadow-sm transition-colors hover:bg-muted/60"
                >
                  <p className="text-sm leading-snug">
                    <Link
                      href={withReturnTo(
                        notification.actionUrl || "/help-feedback",
                        returnTo
                      )}
                      className="hover:underline"
                    >
                      <span className="font-semibold">{notification.title}</span>
                    </Link>
                  </p>
                  {notification.body && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {notification.body}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(notification.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}

          {(eventNotifications.length > 0 ||
            supportTicketNotifications.length > 0) &&
            pendingCount > 0 && (
            <div className="border-t border-border/60" />
          )}

          {(pendingRequests ?? []).map((request) => (
            <div
              key={request.id}
              className="flex items-start gap-4 rounded-xl border border-border/60 bg-muted/40 p-4 shadow-sm transition-colors hover:bg-muted/60"
            >
              <UserAvatar
                src={request.user.avatarImageUrl}
                name={request.user.firstName}
                className="h-10 w-10"
              />

              <div className="flex-1 space-y-3">
                <div>
                  <p className="font-semibold leading-snug">
                    {request.user.firstName} {request.user.lastName}
                  </p>
                  <p className="text-muted-foreground">
                    @{request.user.username}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(request.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1 text-xs"
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
                      acceptMutation.isPending || rejectMutation.isPending
                    }
                  >
                    <X className="mr-1 h-3 w-3" />
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 flex-1 text-xs"
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
                      acceptMutation.isPending || rejectMutation.isPending
                    }
                  >
                    <Check className="mr-1 h-3 w-3" />
                    Accept
                  </Button>
                </div>
              </div>
            </div>
          ))}
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
              {hasNotifications && (
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
              {hasNotifications && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
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
