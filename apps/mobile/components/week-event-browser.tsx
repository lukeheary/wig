import { addDays, format, isSameDay, isToday } from "date-fns";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { EventCard, EVENT_CARD_WIDTH } from "./event-card";
import { Card } from "./ui";
import { mobileTheme } from "../lib/theme";
import type { EventListItem } from "../types/api";

type WeekEventBrowserProps = {
  weekStart: Date;
  events?: EventListItem[];
  loading?: boolean;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  emptyMessage?: string;
};

function formatWeekRange(weekStart: Date) {
  const weekEnd = addDays(weekStart, 6);
  const sameMonth = format(weekStart, "MMM") === format(weekEnd, "MMM");

  if (sameMonth) {
    return `${format(weekStart, "MMM d")} - ${format(weekEnd, "d")}`;
  }

  return `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d")}`;
}

function getWeekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function buildEventsByDay(events: EventListItem[]) {
  return events.reduce<Record<string, EventListItem[]>>((groups, event) => {
    const key = format(new Date(event.startAt), "yyyy-MM-dd");

    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(event);
    groups[key].sort(
      (left, right) =>
        new Date(left.startAt).getTime() - new Date(right.startAt).getTime()
    );

    return groups;
  }, {});
}

export function WeekEventBrowser({
  weekStart,
  events = [],
  loading = false,
  onPreviousWeek,
  onNextWeek,
  emptyMessage = "No events lined up for this week yet.",
}: WeekEventBrowserProps) {
  const days = getWeekDays(weekStart);
  const eventsByDay = buildEventsByDay(events);

  return (
    <View style={styles.container}>
      <View style={styles.navRow}>
        <Pressable style={styles.navButton} onPress={onPreviousWeek}>
          <Text style={styles.navButtonText}>Prev</Text>
        </Pressable>
        <View style={styles.navCenter}>
          <Text style={styles.navEyebrow}>Week view</Text>
          <Text style={styles.navTitle}>{formatWeekRange(weekStart)}</Text>
        </View>
        <Pressable style={styles.navButton} onPress={onNextWeek}>
          <Text style={styles.navButtonText}>Next</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.summaryRow}
      >
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const count = eventsByDay[key]?.length ?? 0;
          const today = isToday(day);

          return (
            <View key={key} style={[styles.summaryPill, today && styles.summaryPillActive]}>
              <Text style={[styles.summaryDay, today && styles.summaryDayActive]}>
                {format(day, "EEE")}
              </Text>
              <Text style={[styles.summaryDate, today && styles.summaryDateActive]}>
                {format(day, "d")}
              </Text>
              <Text style={[styles.summaryCount, today && styles.summaryCountActive]}>
                {count === 1 ? "1 event" : `${count} events`}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={mobileTheme.colors.foreground} />
          <Text style={styles.loadingText}>Loading this week...</Text>
        </View>
      ) : null}

      {!loading && events.length === 0 ? (
        <Card>
          <Text style={styles.emptyWeekText}>{emptyMessage}</Text>
        </Card>
      ) : null}

      {!loading && events.length > 0
        ? days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayEvents = eventsByDay[key] ?? [];
            const today = isToday(day);

            return (
              <View key={key} style={styles.daySection}>
                <View style={styles.dayHeader}>
                  <View>
                    <Text style={[styles.dayTitle, today && styles.dayTitleActive]}>
                      {today ? "Today" : format(day, "EEEE")}
                    </Text>
                    <Text style={styles.daySubtitle}>
                      {format(day, "MMM d")}
                      {isSameDay(day, weekStart) ? " • Week start" : ""}
                    </Text>
                  </View>
                  <Text style={styles.dayCount}>
                    {dayEvents.length === 1 ? "1 event" : `${dayEvents.length} events`}
                  </Text>
                </View>

                {dayEvents.length === 0 ? (
                  <Card>
                    <Text style={styles.emptyDayText}>Nothing scheduled yet.</Text>
                  </Card>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.rail}
                  >
                    {dayEvents.map((event) => (
                      <View key={event.id} style={styles.cardSlot}>
                        <EventCard event={event} />
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 18,
  },
  navRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  navButton: {
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 999,
    minWidth: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  navButtonText: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 13,
    textAlign: "center",
  },
  navCenter: {
    alignItems: "center",
    flex: 1,
    gap: 2,
  },
  navEyebrow: {
    color: mobileTheme.colors.accent,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  navTitle: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 20,
  },
  summaryRow: {
    gap: 10,
    paddingRight: 20,
  },
  summaryPill: {
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 20,
    minWidth: 84,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  summaryPillActive: {
    backgroundColor: mobileTheme.colors.accent,
  },
  summaryDay: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 12,
    textTransform: "uppercase",
  },
  summaryDayActive: {
    color: mobileTheme.colors.background,
  },
  summaryDate: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 20,
    marginTop: 4,
  },
  summaryDateActive: {
    color: mobileTheme.colors.background,
  },
  summaryCount: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 12,
    marginTop: 4,
  },
  summaryCountActive: {
    color: mobileTheme.colors.background,
  },
  loadingState: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
  },
  loadingText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 14,
  },
  daySection: {
    gap: 12,
  },
  dayHeader: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayTitle: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 22,
  },
  dayTitleActive: {
    color: mobileTheme.colors.accent,
  },
  daySubtitle: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 14,
    marginTop: 2,
  },
  dayCount: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 13,
  },
  rail: {
    gap: 12,
    paddingRight: 20,
  },
  cardSlot: {
    width: EVENT_CARD_WIDTH,
  },
  emptyWeekText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
  },
  emptyDayText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 14,
  },
});
