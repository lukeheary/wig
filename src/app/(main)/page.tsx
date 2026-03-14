"use client";

import { useState, useMemo } from "react";
import { format, addDays, startOfDay } from "date-fns";
import { trpc } from "@/lib/trpc";
import { EventCard } from "@/components/calendar/event-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Users, Building2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EventFilterSelect } from "@/components/events/event-filter-select";
import { EventFilterTab } from "@/types/events";

export default function HomePage() {
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = useState<EventFilterTab>("all");

  // Calculate 7-day range starting from today
  const dateRange = useMemo(() => {
    const today = startOfDay(new Date());
    const endDate = addDays(today, 7);
    return { startDate: today, endDate };
  }, []);

  // Fetch events with current filters
  const {
    data: events,
    isLoading,
    error,
  } = trpc.event.listEventsByRange.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    followedOnly: activeFilter === "followed",
    friendsGoingOnly: activeFilter === "friends",
    rsvpStatusFilter:
      activeFilter === "going" || activeFilter === "interested"
        ? activeFilter
        : undefined,
  });

  // Group events by day
  const eventsByDay = useMemo(() => {
    if (!events) return {};

    const grouped: Record<string, typeof events> = {};

    for (let i = 0; i < 7; i++) {
      const date = addDays(dateRange.startDate, i);
      const dateKey = format(date, "yyyy-MM-dd");
      grouped[dateKey] = [];
    }

    events.forEach((event) => {
      const dateKey = format(new Date(event.startAt), "yyyy-MM-dd");
      if (grouped[dateKey]) {
        grouped[dateKey].push(event);
      }
    });

    return grouped;
  }, [events, dateRange.startDate]);

  if (error) {
    toast({
      title: "Error loading events",
      description: error.message,
      variant: "destructive",
    });
  }

  return (
    <div className="container mx-auto space-y-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Calendar</h1>
          <p className="text-muted-foreground">
            Discover local events happening this week
          </p>
        </div>
      </div>


      <EventFilterSelect
        value={activeFilter}
        onValueChange={setActiveFilter}
        className="w-full sm:w-[200px]"
      />

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* 7-Day Calendar Grid */}
      {!isLoading && events && (
        <div className="space-y-6">
          {Object.entries(eventsByDay).map(([dateKey, dayEvents]) => {
            const date = new Date(dateKey);
            const isToday = format(new Date(), "yyyy-MM-dd") === dateKey;

            return (
              <Card key={dateKey}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    <span>
                      {format(date, "EEEE, MMMM d")}
                      {isToday && (
                        <span className="ml-2 text-sm font-normal text-primary">
                          (Today)
                        </span>
                      )}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {dayEvents.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                      No events scheduled for this day
                    </p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {dayEvents.map((event) => (
                        <EventCard key={event.id} event={event} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && events && events.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">No events found</h3>
            <p className="mb-4 text-muted-foreground">
              {activeFilter === "followed" &&
                "Start following businesses to see their events here"}
              {activeFilter === "friends" &&
                "Add friends and see what events they're attending"}
              {activeFilter === "going" &&
                "RSVP going to events to see them here"}
              {activeFilter === "interested" &&
                "Mark events as interested to see them here"}
              {activeFilter === "all" && "Check back later for upcoming events"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
