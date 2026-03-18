"use client";

import {
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  startOfMonth,
  startOfWeek,
  compareAsc,
} from "date-fns";
import { EventCardGrid } from "@/components/events/event-card-grid";
import { EventsPlaceholder } from "@/components/shared/events-placeholder";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { type EventCardItem } from "@/components/calendar/event-card";

interface PlaceUpcomingEventsProps {
  events: EventCardItem[] | null | undefined;
}

function getWeekLabel(weeksAway: number) {
  if (weeksAway <= 0) return "This Week";
  if (weeksAway === 1) return "Next Week";
  return `In ${weeksAway} Weeks`;
}

function getMonthLabel(monthsAway: number) {
  if (monthsAway <= 1) return "Next Month";
  return `In ${monthsAway} Months`;
}

export function PlaceUpcomingEvents({ events }: PlaceUpcomingEventsProps) {
  if (!events || events.length === 0) {
    return (
      <div className="container mx-auto pt-4">
        <EventsPlaceholder />
      </div>
    );
  }

  const now = new Date();
  const currentWeekStart = startOfWeek(now);
  const currentMonthStart = startOfMonth(now);
  const groupedEvents = events
    .slice()
    .sort((left, right) =>
      compareAsc(new Date(left.startAt), new Date(right.startAt))
    )
    .reduce<Array<{ label: string; events: EventCardItem[] }>>(
      (groups, event) => {
        const eventDate = new Date(event.startAt);
        const weeksAway = Math.max(
          0,
          differenceInCalendarWeeks(startOfWeek(eventDate), currentWeekStart)
        );
        const monthsAway = Math.max(
          0,
          differenceInCalendarMonths(startOfMonth(eventDate), currentMonthStart)
        );
        const label =
          weeksAway <= 3 ? getWeekLabel(weeksAway) : getMonthLabel(monthsAway);
        const currentGroup = groups.at(-1);

        if (!currentGroup || currentGroup.label !== label) {
          groups.push({ label, events: [event] });
          return groups;
        }

        currentGroup.events.push(event);
        return groups;
      },
      []
    );

  return (
    <>
      {groupedEvents.map((group) => (
        <div key={group.label} className="pt-4">
          <StickySectionHeader>
            <span className="text-xl font-semibold">{group.label}</span>
          </StickySectionHeader>
          <div className="container mx-auto">
            <EventCardGrid
              events={group.events}
              columns={{ mobile: 1, tablet: 3, desktop: 4 }}
              gap="md"
            />
          </div>
        </div>
      ))}
    </>
  );
}
