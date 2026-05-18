import { Ionicons } from "@expo/vector-icons";
import { addDays, format, isToday, startOfDay, subDays } from "date-fns";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { EventCard } from "./event-card";
import { Card, Pill } from "./ui";
import { mobileTheme } from "../lib/theme";
import type { AvailableCity, EventListItem } from "../types/api";

type CategoryItem = {
  id: string;
  key: string;
  label: string;
};

type HomeFeedSurfaceProps = {
  weekStart: Date;
  isCurrentWeek: boolean;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onResetWeek: () => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  selectedCity: string;
  onSelectCity: (value: string) => void;
  cities: AvailableCity[];
  visibleCategories: CategoryItem[];
  selectedCategories: string[];
  onToggleCategory: (key: string) => void;
  events: EventListItem[];
  loading?: boolean;
};

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

function getDateHeader(date: Date, isCurrentWeek: boolean) {
  const now = new Date();
  const isEarlyMorning = now.getHours() < 6;
  const yesterday = startOfDay(subDays(now, 1));
  const today = isToday(date);
  const isLastNightSection =
    isCurrentWeek &&
    isEarlyMorning &&
    format(date, "yyyy-MM-dd") === format(yesterday, "yyyy-MM-dd");
  const isEvening = now.getHours() >= 17;

  if (isLastNightSection) {
    return {
      title: "Last Night's Events",
      isToday: false,
      isLastNightSection: true,
    };
  }

  if (today) {
    return {
      title: isEvening ? "Tonight's Events" : "Today's Events",
      isToday: true,
      isLastNightSection: false,
    };
  }

  return {
    title: format(date, "EEE, MMM d"),
    isToday: false,
    isLastNightSection: false,
  };
}

function SearchInputRow({
  value,
  onChange,
  showBack,
  onBack,
  showResetWeek,
  onResetWeek,
  isCurrentWeek,
  onPreviousWeek,
  onNextWeek,
}: {
  value: string;
  onChange: (value: string) => void;
  showBack: boolean;
  onBack: () => void;
  showResetWeek: boolean;
  onResetWeek: () => void;
  isCurrentWeek: boolean;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
}) {
  return (
    <View style={styles.searchRow}>
      <View
        style={[
          styles.leadingSlot,
          !(showBack || showResetWeek) && styles.leadingSlotHidden,
        ]}
      >
        {showBack ? (
          <Pressable style={styles.iconButton} onPress={onBack}>
            <Ionicons
              name="arrow-back"
              size={20}
              color={mobileTheme.colors.mutedForeground}
            />
          </Pressable>
        ) : null}
        {!showBack && showResetWeek ? (
          <Pressable style={styles.iconButton} onPress={onResetWeek}>
            <Ionicons
              name="chevron-back"
              size={20}
              color={mobileTheme.colors.mutedForeground}
            />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.searchInputWrap}>
        <Ionicons
          name="search-outline"
          size={18}
          color={mobileTheme.colors.mutedForeground}
          style={styles.searchIcon}
        />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Search events..."
          placeholderTextColor={mobileTheme.colors.mutedForeground}
          style={styles.searchInput}
        />
        {value ? (
          <Pressable style={styles.clearButton} onPress={() => onChange("")}>
            <Ionicons
              name="close"
              size={16}
              color={mobileTheme.colors.mutedForeground}
            />
          </Pressable>
        ) : null}
      </View>

      {!value.trim() ? (
        <View style={styles.navGroup}>
          <Pressable
            style={[styles.navStepButton, isCurrentWeek && styles.navStepDisabled]}
            onPress={onPreviousWeek}
            disabled={isCurrentWeek}
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={
                isCurrentWeek
                  ? mobileTheme.colors.border
                  : mobileTheme.colors.foreground
              }
            />
          </Pressable>
          <Pressable style={styles.navStepButton} onPress={onNextWeek}>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={mobileTheme.colors.foreground}
            />
          </Pressable>
        </View>
      ) : (
        <View style={styles.navGroupHidden} />
      )}
    </View>
  );
}

function LoadingGrid() {
  return (
    <View style={styles.grid}>
      {Array.from({ length: 6 }).map((_, index) => (
        <View key={`skeleton-${index}`} style={styles.gridItem}>
          <View style={styles.skeletonCard}>
            <View style={styles.skeletonImage} />
            <View style={styles.skeletonBody}>
              <View style={styles.skeletonLineWide} />
              <View style={styles.skeletonLineMedium} />
              <View style={styles.skeletonLineShort} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

export function HomeFeedSurface({
  weekStart,
  isCurrentWeek,
  searchQuery,
  onSearchQueryChange,
  onResetWeek,
  onPreviousWeek,
  onNextWeek,
  selectedCity,
  onSelectCity,
  cities,
  visibleCategories,
  selectedCategories,
  onToggleCategory,
  events,
  loading = false,
}: HomeFeedSurfaceProps) {
  const isSearching = Boolean(searchQuery.trim());
  const eventsByDay = buildEventsByDay(events);
  const daysToDisplay = getWeekDays(weekStart);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        stickyHeaderIndices={[0]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.stickyHeader}>
          <SearchInputRow
            value={searchQuery}
            onChange={onSearchQueryChange}
            showBack={isSearching}
            onBack={() => onSearchQueryChange("")}
            showResetWeek={!isSearching && !isCurrentWeek}
            onResetWeek={onResetWeek}
            isCurrentWeek={isCurrentWeek}
            onPreviousWeek={onPreviousWeek}
            onNextWeek={onNextWeek}
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            <Pill active={!selectedCity} onPress={() => onSelectCity("")}>
              All Cities
            </Pill>
            {cities.slice(0, 10).map((city) => (
              <Pill
                key={`${city.city}-${city.state}`}
                active={selectedCity === city.city}
                onPress={() =>
                  onSelectCity(selectedCity === city.city ? "" : city.city)
                }
              >
                {city.city}
              </Pill>
            ))}
          </ScrollView>

          {visibleCategories.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {visibleCategories.map((category) => (
                <Pill
                  key={category.id}
                  active={selectedCategories.includes(category.key)}
                  onPress={() => onToggleCategory(category.key)}
                >
                  {category.label}
                </Pill>
              ))}
            </ScrollView>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={mobileTheme.colors.foreground} />
          </View>
        ) : null}

        {loading ? <LoadingGrid /> : null}

        {!loading && isSearching ? (
          events.length > 0 ? (
            <View style={styles.grid}>
              {events.map((event) => (
                <View key={event.id} style={styles.gridItem}>
                  <EventCard event={event} />
                </View>
              ))}
            </View>
          ) : (
            <Card>
              <Text style={styles.emptyText}>No events found.</Text>
            </Card>
          )
        ) : null}

        {!loading && !isSearching
          ? daysToDisplay.map((date) => {
              const key = format(date, "yyyy-MM-dd");
              const dayEvents = eventsByDay[key] ?? [];
              const { title, isToday, isLastNightSection } = getDateHeader(
                date,
                isCurrentWeek
              );

              if (isLastNightSection && dayEvents.length === 0) {
                return null;
              }

              return (
                <View key={key} style={styles.daySection}>
                  <Text style={[styles.dayTitle, isToday && styles.dayTitleToday]}>
                    {title}
                  </Text>

                  {dayEvents.length === 0 ? (
                    <Card>
                      <Text style={styles.emptyText}>No events scheduled.</Text>
                    </Card>
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.rail}
                    >
                      {dayEvents.map((event) => (
                        <View key={event.id} style={styles.railItem}>
                          <EventCard event={event} />
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>
              );
            })
          : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: mobileTheme.colors.background,
    flex: 1,
  },
  content: {
    gap: 16,
    paddingBottom: 24,
  },
  stickyHeader: {
    backgroundColor: mobileTheme.colors.background,
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  searchRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  leadingSlot: {
    marginRight: 8,
    width: 40,
  },
  leadingSlotHidden: {
    marginRight: 0,
    width: 0,
  },
  iconButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  searchInputWrap: {
    backgroundColor: mobileTheme.colors.muted,
    borderColor: mobileTheme.colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    height: 48,
    justifyContent: "center",
    paddingLeft: 40,
    paddingRight: 40,
    position: "relative",
  },
  searchIcon: {
    left: 14,
    position: "absolute",
    top: 14,
  },
  searchInput: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 16,
    paddingVertical: 0,
  },
  clearButton: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    position: "absolute",
    right: 12,
    top: 12,
    width: 24,
  },
  navGroup: {
    borderColor: mobileTheme.colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    height: 48,
    marginLeft: 8,
    overflow: "hidden",
    width: 82,
  },
  navGroupHidden: {
    marginLeft: 8,
    width: 82,
  },
  navStepButton: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.muted,
    flex: 1,
    justifyContent: "center",
  },
  navStepDisabled: {
    opacity: 0.5,
  },
  filterRow: {
    gap: 6,
    paddingRight: 16,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 24,
  },
  daySection: {
    gap: 12,
    paddingHorizontal: 16,
  },
  dayTitle: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayMedium,
    fontSize: 22,
    paddingHorizontal: 2,
  },
  dayTitleToday: {
    color: mobileTheme.colors.accent,
  },
  rail: {
    gap: 12,
    paddingRight: 16,
  },
  railItem: {
    width: 212,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  gridItem: {
    width: "48%",
  },
  emptyText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 14,
  },
  skeletonCard: {
    backgroundColor: mobileTheme.colors.card,
    borderColor: mobileTheme.colors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 8,
  },
  skeletonImage: {
    aspectRatio: 0.98,
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 20,
  },
  skeletonBody: {
    gap: 8,
    paddingHorizontal: 4,
    paddingTop: 12,
  },
  skeletonLineWide: {
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 999,
    height: 12,
    width: "88%",
  },
  skeletonLineMedium: {
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 999,
    height: 10,
    width: "62%",
  },
  skeletonLineShort: {
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 999,
    height: 10,
    width: "56%",
  },
});
