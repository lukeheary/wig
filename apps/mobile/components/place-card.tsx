import { Image, StyleSheet, Text, View } from "react-native";
import { mobileTheme } from "../lib/theme";
import type { PlaceListItem } from "../types/api";

export function PlaceCard({ place }: { place: PlaceListItem }) {
  const initials = place.name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <View style={styles.card}>
      {place.logoImageUrl ? (
        <Image source={{ uri: place.logoImageUrl }} style={styles.image} />
      ) : (
        <View style={styles.imageFallback}>
          <Text style={styles.imageFallbackText}>{initials}</Text>
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.title}>{place.name}</Text>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {place.type === "venue" ? "Venue" : "Organizer"}
            </Text>
          </View>
        </View>

        <Text style={styles.meta}>
          {place.city}, {place.state}
        </Text>

        {place.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {place.description}
          </Text>
        ) : null}

        <Text style={styles.countText}>
          {place.eventCount === 1 ? "1 upcoming event" : `${place.eventCount} upcoming events`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileTheme.colors.card,
    borderColor: mobileTheme.colors.border,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 12,
  },
  image: {
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 20,
    height: 88,
    width: 88,
  },
  imageFallback: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 20,
    height: 88,
    justifyContent: "center",
    width: 88,
  },
  imageFallbackText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 24,
  },
  body: {
    flex: 1,
    gap: 6,
    paddingVertical: 2,
  },
  topRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  title: {
    color: mobileTheme.colors.foreground,
    flex: 1,
    fontFamily: mobileTheme.fonts.displayMedium,
    fontSize: 18,
  },
  typeBadge: {
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  typeBadgeText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 11,
    textTransform: "uppercase",
  },
  meta: {
    color: mobileTheme.colors.accent,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 13,
  },
  description: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
  },
  countText: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 13,
    marginTop: 2,
  },
});
