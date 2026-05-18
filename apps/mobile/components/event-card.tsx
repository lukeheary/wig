import { Link } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import {
  formatTime,
  splitTrailingParenthetical,
  withImageVersion,
} from "../lib/mobile-utils";
import { mobileTheme } from "../lib/theme";
import { type EventListItem } from "../types/api";

export const EVENT_CARD_WIDTH = 212;

export function EventCard({ event }: { event: EventListItem }) {
  const imageUrl =
    withImageVersion(event.coverImageUrl, event.updatedAt) ||
    event.venue?.logoImageUrl ||
    event.organizer?.logoImageUrl ||
    null;
  const venueName = event.venue?.name ?? event.organizer?.name ?? "TBA";
  const titleParts = splitTrailingParenthetical(event.title);
  const eventDate = new Date(event.startAt);

  return (
    <Link href={`/events/${event.id}`} asChild>
      <Pressable style={styles.card}>
        <View style={styles.imageWrap}>
          {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.image} /> : null}
          {!imageUrl ? (
            <View style={styles.imageFallback}>
              <Text style={styles.imageFallbackText}>
                {event.title.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {titleParts.main}
            {titleParts.trailingParenthetical ? ` ${titleParts.trailingParenthetical}` : ""}
          </Text>
          <Text style={styles.date}>
            {eventDate.toLocaleString("en-US", {
              month: "short",
              day: "numeric",
            })}{" "}
            at {formatTime(event.startAt)}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {venueName}
          </Text>
          <View style={styles.cardSpacer} />
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileTheme.colors.card,
    borderRadius: 24,
    flex: 1,
    overflow: "hidden",
    padding: 8,
  },
  imageWrap: {
    borderRadius: 20,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    aspectRatio: 0.98,
    backgroundColor: mobileTheme.colors.muted,
  },
  imageFallback: {
    alignItems: "center",
    aspectRatio: 0.98,
    backgroundColor: mobileTheme.colors.muted,
    justifyContent: "center",
    width: "100%",
  },
  imageFallbackText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 42,
  },
  body: {
    flex: 1,
    minHeight: 104,
    paddingBottom: 4,
    paddingHorizontal: 4,
    paddingTop: 12,
  },
  title: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayMedium,
    fontSize: 14,
    lineHeight: 20,
  },
  date: {
    color: mobileTheme.colors.accent,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    paddingTop: 4,
  },
  meta: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
    paddingTop: 4,
  },
  cardSpacer: {
    flex: 1,
  },
});
