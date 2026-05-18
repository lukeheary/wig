import { Stack, useLocalSearchParams } from "expo-router";
import { Alert, Image, Linking, StyleSheet, Text, View } from "react-native";
import { Screen } from "../../components/screen";
import { Button, Card } from "../../components/ui";
import { formatDateTime, withImageVersion } from "../../lib/mobile-utils";
import { mobileTheme } from "../../lib/theme";
import { trpc } from "../../lib/trpc";

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventQuery = trpc.event.getEventById.useQuery({
    eventId: id,
  });

  const event = eventQuery.data;
  const imageUrl =
    withImageVersion(event?.coverImageUrl, event?.updatedAt) ||
    event?.venue?.logoImageUrl ||
    event?.organizer?.logoImageUrl ||
    null;

  return (
    <Screen>
      <Stack.Screen options={{ title: event?.title ?? "Event" }} />
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={styles.heroImage}
        />
      ) : null}
      <Card>
        <Text style={styles.title}>
          {event?.title}
        </Text>
        <Text style={styles.meta}>
          {event ? formatDateTime(event.startAt) : ""}
        </Text>
        <Text style={styles.meta}>
          {[event?.city, event?.state].filter(Boolean).join(", ")}
        </Text>
        {event?.description ? (
          <Text style={styles.description}>
            {event.description}
          </Text>
        ) : null}
        <Button
          variant="secondary"
          onPress={() =>
            Alert.alert(
              "RSVP requires sign in",
              "Native authenticated RSVP is temporarily disabled in this Expo-safe build."
            )
          }
        >
          Going
        </Button>
        <Button
          variant="ghost"
          onPress={() =>
            Alert.alert(
              "RSVP requires sign in",
              "Native authenticated RSVP is temporarily disabled in this Expo-safe build."
            )
          }
        >
          Interested
        </Button>
        {event?.eventUrl ? (
          <Button
            variant="ghost"
            onPress={() => {
              void Linking.openURL(event.eventUrl!);
            }}
          >
            Open event link
          </Button>
        ) : null}
      </Card>
      <View>
        <Text style={styles.socialText}>
          {(event?.friendsGoing?.length ?? 0)} going •{" "}
          {(event?.friendsInterested?.length ?? 0)} interested
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroImage: {
    width: "100%",
    height: 260,
    borderRadius: 24,
  },
  title: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 28,
  },
  meta: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    lineHeight: 22,
  },
  description: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    lineHeight: 24,
  },
  socialText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
  },
});
