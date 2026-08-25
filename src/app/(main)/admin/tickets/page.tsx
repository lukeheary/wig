"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Ticket } from "lucide-react";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "in-review", label: "In Review" },
  { value: "planned", label: "Planned" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
] as const;

const statusLabels = {
  open: "Open",
  "in-review": "In Review",
  planned: "Planned",
  resolved: "Resolved",
  closed: "Closed",
} as const;

const statusVariants = {
  open: "secondary",
  "in-review": "outline",
  planned: "default",
  resolved: "default",
  closed: "secondary",
} as const;

const typeLabels = {
  help: "Get Help",
  bug: "Report a Bug",
  "incorrect-data": "Incorrect Data",
  "feature-request": "Request a Feature",
  "event-request": "Request Event",
  "place-request": "Request Place",
  feedback: "Share Feedback",
} as const;

const severityLabels = {
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;

const severityVariants = {
  low: "outline",
  medium: "secondary",
  high: "destructive",
} as const;

type TicketStatus = Exclude<(typeof statusOptions)[number]["value"], "all">;
type UserModerationStatus = "active" | "suspended" | "banned";

const userModerationStatusLabels: Record<UserModerationStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  banned: "Banned",
};

export default function AdminTicketsPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] =
    useState<(typeof statusOptions)[number]["value"]>("open");
  const [search, setSearch] = useState("");

  const {
    data: tickets,
    isLoading,
    isError,
  } = trpc.admin.listSupportTickets.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search.trim() || undefined,
  });

  const updateTicketStatus = trpc.admin.updateSupportTicketStatus.useMutation({
    onSuccess: async () => {
      await utils.admin.listSupportTickets.invalidate();
      toast({ title: "Ticket status updated" });
    },
    onError: (error) => {
      toast({
        title: "Could not update ticket",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateReportedUserStatus =
    trpc.admin.updateReportedUserModerationStatus.useMutation({
      onSuccess: async () => {
        await utils.admin.listSupportTickets.invalidate();
        toast({ title: "User moderation status updated" });
      },
      onError: (error) => {
        toast({
          title: "Could not update user",
          description: error.message,
          variant: "destructive",
        });
      },
    });

  return (
    <div className="space-y-4">
      <BackButtonHeader backHref="/admin" title="Support Tickets" />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search subject, message, email, or username"
          />
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as (typeof statusOptions)[number]["value"])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tickets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading tickets...
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive">
              We couldn&apos;t load support tickets right now.
            </p>
          ) : tickets && tickets.length > 0 ? (
            tickets.map((ticket) => {
              const displayName =
                [ticket.firstName, ticket.lastName].filter(Boolean).join(" ") ||
                ticket.username ||
                ticket.userEmail;

              return (
                <div
                  key={ticket.id}
                  className="rounded-xl border border-border/70 bg-muted/10 px-4 py-3 transition-colors hover:bg-muted/20"
                >
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <UserAvatar
                        src={ticket.avatarImageUrl}
                        name={displayName}
                        className="h-10 w-10 shrink-0"
                      />

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <p className="truncate font-semibold">
                            {displayName}
                          </p>
                          <p className="truncate text-muted-foreground">
                            @{ticket.username}
                          </p>
                          <span className="hidden text-muted-foreground sm:inline">
                            •
                          </span>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(ticket.createdAt), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>

                        <div className="flex min-w-0 items-baseline gap-2">
                          <h2 className="truncate text-sm font-semibold sm:text-base">
                            {ticket.subject}
                          </h2>
                          <div className="hidden items-center gap-2 sm:flex">
                            <Badge
                              variant="outline"
                              className="h-6 font-medium"
                            >
                              {typeLabels[ticket.type]}
                            </Badge>
                            <Badge
                              variant={severityVariants[ticket.severity]}
                              className="h-6 font-medium"
                            >
                              {severityLabels[ticket.severity]}
                            </Badge>
                          </div>
                        </div>

                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {ticket.message}
                        </p>

                        {ticket.reportedEntityType === "user" &&
                        ticket.reportedEntityId &&
                        ticket.reportedUserModerationStatus ? (
                          <div className="flex max-w-[220px] items-center gap-2 pt-1">
                            <span className="shrink-0 text-xs font-medium text-muted-foreground">
                              Reported user:
                            </span>
                            <Select
                              value={ticket.reportedUserModerationStatus}
                              onValueChange={(value) =>
                                updateReportedUserStatus.mutate({
                                  ticketId: ticket.id,
                                  moderationStatus:
                                    value as UserModerationStatus,
                                })
                              }
                              disabled={updateReportedUserStatus.isPending}
                            >
                              <SelectTrigger className="h-8 rounded-lg bg-background/70 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(userModerationStatusLabels).map(
                                  ([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                      {label}
                                    </SelectItem>
                                  )
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 xl:w-[220px] xl:justify-end">
                      <div className="flex items-center gap-2 sm:hidden">
                        <Badge variant="outline" className="h-6 font-medium">
                          {typeLabels[ticket.type]}
                        </Badge>
                        <Badge
                          variant={severityVariants[ticket.severity]}
                          className="h-6 font-medium"
                        >
                          {severityLabels[ticket.severity]}
                        </Badge>
                      </div>

                      <div className="w-full max-w-[180px] xl:max-w-[170px]">
                        <Select
                          value={ticket.status}
                          onValueChange={(value) =>
                            updateTicketStatus.mutate({
                              ticketId: ticket.id,
                              status: value as TicketStatus,
                            })
                          }
                          disabled={updateTicketStatus.isPending}
                        >
                          <SelectTrigger className="h-10 rounded-xl bg-background/70 px-4">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {statusOptions
                              .filter((option) => option.value !== "all")
                              .map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Ticket className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">No tickets found</p>
                <p className="text-sm text-muted-foreground">
                  Try a different filter or wait for new submissions.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
