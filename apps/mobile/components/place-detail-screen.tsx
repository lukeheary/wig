import { useMemo } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Screen } from "./screen";
import { Button, Card, Pill } from "./ui";
import { EventCard } from "./event-card";
import { mobileTheme } from "../lib/theme";
import { trpc } from "../lib/trpc";
import type { PlaceDetail } from "../types/api";
import { useAuth } from "@clerk/expo";

function formatWebsite(url?: string | null) {
  if (!url) return null;
  return url
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/\/.*$/, "");
}

function getPlaceSubtitle(place: PlaceDetail) {
  if (place.type === "venue") {
    return [place.city, place.state].filter(Boolean).join(", ");
  }

  return place.city && place.state
    ? `${place.city}, ${place.state} (Organizer)`
    : "Organizer";
}

function getMemberNames(place: PlaceDetail) {
  return (place.members ?? [])
    .map((member) => {
      const user = member.user;
      if (!user) return null;
      return (
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
        user.username ||
        null
      );
    })
    .filter(Boolean)
    .slice(0, 4);
}

export function PlaceDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const utils = trpc.useUtils();
  const placeQuery = trpc.place.getPlaceBySlug.useQuery(
    { slug: slug ?? "" },
    { enabled: Boolean(slug) }
  );
  const place = placeQuery.data as PlaceDetail | undefined;

  const isFollowingQuery = trpc.place.isFollowingPlace.useQuery(
    { placeId: place?.id ?? "" },
    {
      enabled: Boolean(place?.id) && isSignedIn === true,
    }
  );

  const followMutation = trpc.place.followPlace.useMutation({
    onSuccess: () => {
      utils.place.getPlaceBySlug.invalidate({ slug });
      utils.place.isFollowingPlace.invalidate({ placeId: place?.id ?? "" });
    },
  });

  const unfollowMutation = trpc.place.unfollowPlace.useMutation({
    onSuccess: () => {
      utils.place.getPlaceBySlug.invalidate({ slug });
      utils.place.isFollowingPlace.invalidate({ placeId: place?.id ?? "" });
    },
  });

  const memberNames = useMemo(
    () => (place ? getMemberNames(place) : []),
    [place]
  );

  async function handleFollowToggle() {
    if (!place) return;

    if (!isSignedIn) {
      router.push("/(auth)");
      return;
    }

    if (isFollowingQuery.data) {
      await unfollowMutation.mutateAsync({ placeId: place.id });
      return;
    }

    await followMutation.mutateAsync({ placeId: place.id });
  }

  const title = place?.name ?? (slug ? String(slug) : "Place");

  return (
    <Screen>
      <Stack.Screen options={{ title, headerBackTitle: "Back" }} />

      {placeQuery.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={mobileTheme.colors.accent} size="large" />
        </View>
      ) : null}

      {!placeQuery.isLoading && !place ? (
        <Card>
          <Text style={styles.title}>Place not found</Text>
          <Text style={styles.mutedText}>
            This venue or organizer could not be loaded.
          </Text>
        </Card>
      ) : null}

      {place ? (
        <>
          <Card>
            <View style={styles.heroRow}>
              {place.logoImageUrl ? (
                <Image source={{ uri: place.logoImageUrl }} style={styles.heroImage} />
              ) : (
                <View style={styles.heroFallback}>
                  <Text style={styles.heroFallbackText}>
                    {place.name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}

              <View style={styles.heroText}>
                <Text style={styles.title}>{place.name}</Text>
                <Text style={styles.slug}>@{place.slug}</Text>
                <Text style={styles.meta}>{getPlaceSubtitle(place)}</Text>
              </View>
            </View>

            <View style={styles.pillRow}>
              {(place.categories ?? []).slice(0, 6).map((category) => (
                <Pill key={category}>{category}</Pill>
              ))}
            </View>

            {place.description ? (
              <Text style={styles.bodyText}>{place.description}</Text>
            ) : null}

            {place.address ? (
              <Text style={styles.bodyText}>{place.address}</Text>
            ) : null}

            {place.instagram ? (
              <Text style={styles.linkText}>@{place.instagram}</Text>
            ) : null}

            {place.website ? (
              <Text style={styles.linkText}>{formatWebsite(place.website)}</Text>
            ) : null}

            {memberNames.length > 0 ? (
              <Text style={styles.mutedText}>
                Members: {memberNames.join(", ")}
              </Text>
            ) : null}

            <Button
              variant={isFollowingQuery.data ? "secondary" : "primary"}
              onPress={handleFollowToggle}
              loading={followMutation.isPending || unfollowMutation.isPending}
            >
              {isFollowingQuery.data ? "Following" : "Follow"}
            </Button>
          </Card>

          {place.events?.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Upcoming Events</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.eventRow}
              >
                {place.events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {place.pastEvents?.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Past Events</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.eventRow}
              >
                {place.pastEvents.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </ScrollView>
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bodyText: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
  },
  eventRow: {
    gap: 12,
    paddingRight: 20,
  },
  heroFallback: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 24,
    height: 96,
    justifyContent: "center",
    width: 96,
  },
  heroFallbackText: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 28,
  },
  heroImage: {
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 24,
    height: 96,
    width: 96,
  },
  heroRow: {
    flexDirection: "row",
    gap: 14,
  },
  heroText: {
    flex: 1,
    gap: 4,
    justifyContent: "center",
  },
  linkText: {
    color: mobileTheme.colors.accent,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 14,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 220,
  },
  meta: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
  },
  mutedText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 26,
  },
  slug: {
    color: mobileTheme.colors.accent,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 14,
  },
  title: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 28,
  },
});
