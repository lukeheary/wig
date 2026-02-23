"use client";

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

export function NotificationsBell() {
  const { toast } = useToast();
  const { data: pendingRequests, refetch } =
    trpc.friends.getPendingRequests.useQuery();
  const { data: eventUpdates } = trpc.event.getMyEventActivity.useQuery({
    limit: 20,
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
  const eventUpdatesCount = eventUpdates?.length ?? 0;
  const notificationCount = pendingCount + eventUpdatesCount;
  const hasNotifications = notificationCount > 0;

  const getEventUpdateText = (type: string) => {
    switch (type) {
      case "cancelled":
        return "cancelled";
      case "postponed":
        return "postponed";
      case "rescheduled":
        return "rescheduled";
      case "restored":
        return "restored";
      case "created":
        return "created";
      default:
        return "updated";
    }
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
          {eventUpdatesCount > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Event updates
              </p>
              {eventUpdates!.map((update: any) => (
                <div
                  key={update.id}
                  className="rounded-xl border border-border/60 bg-muted/40 p-4 shadow-sm transition-colors hover:bg-muted/60"
                >
                  <p className="text-sm leading-snug">
                    <span className="font-semibold">
                      {update.actor?.firstName || update.actor?.lastName
                        ? `${update.actor?.firstName || ""} ${update.actor?.lastName || ""}`.trim()
                        : "Someone"}
                    </span>{" "}
                    {getEventUpdateText(update.type)}{" "}
                    <Link
                      href={`/event/${update.eventId}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {update.event?.title || "an event"}
                    </Link>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(update.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}

          {eventUpdatesCount > 0 && pendingCount > 0 && (
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
                    onClick={() =>
                      rejectMutation.mutate({
                        friendRequestId: request.id,
                      })
                    }
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
                    onClick={() =>
                      acceptMutation.mutate({
                        friendRequestId: request.id,
                      })
                    }
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
        <Sheet>
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
        <Popover>
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
