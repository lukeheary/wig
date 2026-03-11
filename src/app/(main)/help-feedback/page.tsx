"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Headset, Loader2, MessageSquarePlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const ticketTypes = [
  { value: "help", label: "Get Help" },
  { value: "bug", label: "Report a Bug" },
  { value: "feature-request", label: "Request a Feature" },
  { value: "feedback", label: "Share Feedback" },
] as const;

const statusLabels = {
  open: "Open",
  "in-review": "In Review",
  closed: "Closed",
  planned: "Planned",
  resolved: "Resolved",
} as const;

const statusVariants = {
  open: "secondary",
  "in-review": "outline",
  closed: "secondary",
  planned: "default",
  resolved: "default",
} as const;

type SupportTicketType = (typeof ticketTypes)[number]["value"];

export default function HelpFeedbackPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [type, setType] = useState<SupportTicketType>("help");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const {
    data: tickets,
    isLoading,
    isError,
  } = trpc.support.listMine.useQuery();

  const createTicket = trpc.support.create.useMutation({
    onSuccess: async () => {
      setType("help");
      setSubject("");
      setMessage("");
      await utils.support.listMine.invalidate();
      toast({
        title: "Ticket submitted",
        description: "We saved your message and marked it as open.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not submit ticket",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createTicket.mutate({
      type,
      subject,
      message,
    });
  };

  return (
    <div className="container mx-auto flex w-full flex-col gap-6 px-4 md:px-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Open a ticket</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="support-type">Type</Label>
                <Select
                  value={type}
                  onValueChange={(value) => setType(value as SupportTicketType)}
                >
                  <SelectTrigger id="support-type">
                    <SelectValue placeholder="Choose a ticket type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ticketTypes.map((ticketType) => (
                      <SelectItem
                        key={ticketType.value}
                        value={ticketType.value}
                      >
                        {ticketType.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="support-subject">Subject</Label>
                <Input
                  id="support-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Short summary"
                  maxLength={255}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="support-message">Details</Label>
                <Textarea
                  id="support-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Tell us what happened, what you expected, or what would help."
                  rows={7}
                  maxLength={5000}
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={createTicket.isPending}
                className="w-full sm:w-auto"
              >
                {createTicket.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <MessageSquarePlus className="mr-2 h-4 w-4" />
                    Submit ticket
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your tickets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading tickets...
              </div>
            ) : isError ? (
              <p className="text-sm text-destructive">
                We couldn&apos;t load your tickets right now.
              </p>
            ) : tickets && tickets.length > 0 ? (
              tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="rounded-2xl border p-4 transition-colors"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-muted-foreground">
                        {
                          ticketTypes.find(
                            (ticketType) => ticketType.value === ticket.type
                          )?.label
                        }
                      </p>
                      <h2 className="text-base font-semibold">
                        {ticket.subject}
                      </h2>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {ticket.message}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-row items-center gap-2 sm:flex-col sm:items-end">
                      <Badge
                        variant={statusVariants[ticket.status]}
                        className="capitalize"
                      >
                        {statusLabels[ticket.status]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(ticket.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No tickets yet. Submit your first one from the form.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
