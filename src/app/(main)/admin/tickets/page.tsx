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
  "feature-request": "Request a Feature",
  feedback: "Share Feedback",
} as const;

type TicketStatus = Exclude<(typeof statusOptions)[number]["value"], "all">;

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
                  className="rounded-2xl border border-border/70 bg-muted/20 p-5"
                >
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                        <p>
                          Submitted{" "}
                          {formatDistanceToNow(new Date(ticket.createdAt), {
                            addSuffix: true,
                          })}
                        </p>
                        <Badge variant="outline" className="font-medium">
                          {typeLabels[ticket.type]}
                        </Badge>
                      </div>

                      <div className="space-y-3">
                        <h2 className="text-lg font-semibold leading-tight">
                          {ticket.subject}
                        </h2>
                        <div className="rounded-2xl border border-border/70 bg-background/50 px-4 py-4">
                          <div className="flex items-center gap-3">
                            <UserAvatar
                              src={ticket.avatarImageUrl}
                              name={displayName}
                              className="h-11 w-11 shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <p className="truncate text-sm font-semibold">
                                  {displayName}
                                </p>
                                <p className="truncate text-sm text-muted-foreground">
                                  @{ticket.username}
                                </p>
                              </div>
                              <p className="truncate text-sm text-muted-foreground">
                                {ticket.userEmail}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 border-t border-border/60 pt-4">
                            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                              {ticket.message}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="w-full xl:max-w-xs">
                      <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Status
                        </p>
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
                          <SelectTrigger>
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
