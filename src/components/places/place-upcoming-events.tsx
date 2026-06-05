"use client";

import {
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  startOfMonth,
  startOfWeek,
  compareAsc,
  compareDesc,
  parseISO,
} from "date-fns";
import { type EventCardItem } from "@/components/events/event-card-helpers";
import { HomeMobileEventRail } from "@/components/events/home-mobile-event-rail";
import { EventsPlaceholder } from "@/components/shared/events-placeholder";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { formatEventDateKey } from "@/lib/utils";

interface PlaceUpcomingEventsProps {
  events: EventCardItem[] | null | undefined;
  mode?: "upcoming" | "past";
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

function getPastWeekLabel(weeksAgo: number) {
  if (weeksAgo <= 1) return "Last Week";
  return `${weeksAgo} Weeks Ago`;
}

function getPastMonthLabel(monthsAgo: number) {
  if (monthsAgo <= 1) return "Last Month";
  return `${monthsAgo} Months Ago`;
}

export function PlaceUpcomingEvents({
  events,
  mode = "upcoming",
}: PlaceUpcomingEventsProps) {
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
    .sort((left, right) => {
      const leftDate = new Date(left.startAt);
      const rightDate = new Date(right.startAt);
      return mode === "past"
        ? compareDesc(leftDate, rightDate)
        : compareAsc(leftDate, rightDate);
    })
    .reduce<Array<{ label: string; events: EventCardItem[] }>>(
      (groups, event) => {
        const eventDate = parseISO(
          formatEventDateKey(event.startAt, event.timeZone, event.state)
        );
        const weekDifference = differenceInCalendarWeeks(
          startOfWeek(eventDate),
          currentWeekStart
        );
        const monthDifference = differenceInCalendarMonths(
          startOfMonth(eventDate),
          currentMonthStart
        );
        const weeksFromNow = Math.abs(weekDifference);
        const monthsFromNow = Math.abs(monthDifference);
        const label =
          weeksFromNow <= 3
            ? mode === "past"
              ? getPastWeekLabel(weeksFromNow)
              : getWeekLabel(weeksFromNow)
            : mode === "past"
              ? getPastMonthLabel(monthsFromNow)
              : getMonthLabel(monthsFromNow);
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
            <span>{group.label}</span>
          </StickySectionHeader>
          <div className="container mx-auto">
            <HomeMobileEventRail events={group.events} />
          </div>
        </div>
      ))}
    </>
  );
}
