import { Ionicons } from "@expo/vector-icons";
import { addDays, format, isToday, startOfDay, subDays } from "date-fns";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { EventCard } from "./event-card";
import { Card } from "./ui";
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

type SelectorOption = {
  key: string;
  label: string;
  active?: boolean;
  onPress: () => void;
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
              size={18}
              color={mobileTheme.colors.mutedForeground}
            />
          </Pressable>
        ) : null}
        {!showBack && showResetWeek ? (
          <Pressable style={styles.iconButton} onPress={onResetWeek}>
            <Ionicons
              name="chevron-back"
              size={18}
              color={mobileTheme.colors.mutedForeground}
            />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.searchInputWrap}>
        <Ionicons
          name="search-outline"
          size={20}
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

function HeaderControl({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.selectorButton} onPress={onPress}>
      <Text style={styles.selectorButtonText} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons
        name="chevron-down"
        size={16}
        color={mobileTheme.colors.mutedForeground}
      />
    </Pressable>
  );
}

function CategoryChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.categoryChip, active && styles.categoryChipActive]}
    >
      <Text
        style={[styles.categoryChipText, active && styles.categoryChipTextActive]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SelectorSheet({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: SelectorOption[];
  onClose: () => void;
}) {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <Text style={styles.modalTitle}>{title}</Text>
          <View style={styles.modalOptions}>
            {options.map((option) => (
              <Pressable
                key={option.key}
                style={[styles.modalOption, option.active && styles.modalOptionActive]}
                onPress={() => {
                  option.onPress();
                  onClose();
                }}
              >
                <Text
                  style={[
                    styles.modalOptionText,
                    option.active && styles.modalOptionTextActive,
                  ]}
                >
                  {option.label}
                </Text>
                {option.active ? (
                  <Ionicons
                    name="checkmark"
                    size={18}
                    color={mobileTheme.colors.foreground}
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
  const [activeSelector, setActiveSelector] = useState<"city" | "filter" | null>(
    null
  );
  const isSearching = Boolean(searchQuery.trim());
  const eventsByDay = buildEventsByDay(events);
  const daysToDisplay = getWeekDays(weekStart);

  const selectedCityLabel = useMemo(() => {
    if (!selectedCity) {
      return "All Cities";
    }

    const match = cities.find((city) => city.city === selectedCity);

    return match ? `${match.city}, ${match.state}` : selectedCity;
  }, [cities, selectedCity]);

  const cityOptions = useMemo<SelectorOption[]>(
    () => [
      {
        key: "all",
        label: "All Cities",
        active: !selectedCity,
        onPress: () => onSelectCity(""),
      },
      ...cities.map((city) => ({
        key: `${city.city}-${city.state}`,
        label: `${city.city}, ${city.state}`,
        active: selectedCity === city.city,
        onPress: () => onSelectCity(city.city),
      })),
    ],
    [cities, onSelectCity, selectedCity]
  );

  const filterOptions = useMemo<SelectorOption[]>(
    () => [
      {
        key: "all",
        label: "All Events",
        active: true,
        onPress: () => {},
      },
    ],
    []
  );

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

          <View style={styles.selectorRow}>
            <View style={styles.selectorItem}>
              <HeaderControl
                label={selectedCityLabel}
                onPress={() => setActiveSelector("city")}
              />
            </View>
            <View style={styles.selectorItem}>
              <HeaderControl
                label="All Events"
                onPress={() => setActiveSelector("filter")}
              />
            </View>
          </View>

          {visibleCategories.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryScroller}
              contentContainerStyle={styles.categoryRow}
            >
              {visibleCategories.map((category) => (
                <CategoryChip
                  key={category.id}
                  label={category.label}
                  active={selectedCategories.includes(category.key)}
                  onPress={() => onToggleCategory(category.key)}
                />
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

      <SelectorSheet
        visible={activeSelector === "city"}
        title="Choose a city"
        options={cityOptions}
        onClose={() => setActiveSelector(null)}
      />

      <SelectorSheet
        visible={activeSelector === "filter"}
        title="Choose a feed"
        options={filterOptions}
        onClose={() => setActiveSelector(null)}
      />
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
    paddingBottom: 28,
  },
  stickyHeader: {
    backgroundColor: mobileTheme.colors.background,
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 18,
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
    paddingRight: 36,
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
    fontSize: 15,
    paddingVertical: 0,
  },
  clearButton: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    position: "absolute",
    right: 12,
    top: 14,
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
    opacity: 0.45,
  },
  selectorRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  selectorItem: {
    flex: 1,
  },
  selectorButton: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.muted,
    borderColor: mobileTheme.colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  selectorButtonText: {
    color: mobileTheme.colors.foreground,
    flex: 1,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 15,
    paddingRight: 8,
  },
  categoryScroller: {
    marginTop: 10,
  },
  categoryRow: {
    gap: 8,
    paddingRight: 20,
  },
  categoryChip: {
    alignSelf: "flex-start",
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  categoryChipActive: {
    backgroundColor: mobileTheme.colors.accent,
  },
  categoryChipText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 12.5,
  },
  categoryChipTextActive: {
    color: mobileTheme.colors.background,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 24,
  },
  daySection: {
    gap: 12,
    paddingHorizontal: 20,
  },
  dayTitle: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 22,
    letterSpacing: 0,
    paddingHorizontal: 0,
  },
  dayTitleToday: {
    color: mobileTheme.colors.foreground,
  },
  rail: {
    alignItems: "stretch",
    gap: 16,
    paddingRight: 20,
  },
  railItem: {
    alignSelf: "stretch",
    width: 212,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  gridItem: {
    width: "48%",
  },
  emptyText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 14,
  },
  modalBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.62)",
    flex: 1,
    justifyContent: "flex-end",
    padding: 16,
  },
  modalSheet: {
    backgroundColor: mobileTheme.colors.card,
    borderColor: mobileTheme.colors.border,
    borderRadius: 28,
    borderWidth: 1,
    gap: 16,
    padding: 20,
  },
  modalTitle: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayMedium,
    fontSize: 22,
  },
  modalOptions: {
    gap: 8,
  },
  modalOption: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalOptionActive: {
    borderColor: mobileTheme.colors.accent,
    borderWidth: 1,
  },
  modalOptionText: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 16,
  },
  modalOptionTextActive: {
    color: mobileTheme.colors.foreground,
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
    paddingTop: 10,
  },
  skeletonLineWide: {
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 999,
    height: 14,
    width: "82%",
  },
  skeletonLineMedium: {
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 999,
    height: 12,
    width: "56%",
  },
  skeletonLineShort: {
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 999,
    height: 12,
    width: "42%",
  },
});
