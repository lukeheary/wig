import { Image, StyleSheet, Text, View } from "react-native";
import { useAuth, useUser } from "@clerk/expo";
import { useRouter } from "expo-router";
import { Screen } from "../../components/screen";
import { Button, Card, Heading } from "../../components/ui";
import { mobileTheme } from "../../lib/theme";
import { trpc } from "../../lib/trpc";

export default function ProfileScreen() {
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const currentUserQuery = trpc.user.getCurrentUser.useQuery(undefined, {
    enabled: isSignedIn === true,
    retry: false,
  });

  if (!isSignedIn) {
    return (
      <Screen>
        <Heading subtitle="Sign in to manage your profile and RSVP state.">
          Profile
        </Heading>
        <Card>
          <Text style={styles.cardTitle}>You are browsing as a guest</Text>
          <Text style={styles.bodyText}>
            Your feed stays public, but profile, friends, and RSVP actions need
            a WIG account.
          </Text>
          <Button onPress={() => router.push("/(auth)")}>Sign in</Button>
        </Card>
      </Screen>
    );
  }

  const displayName =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    "Your profile";
  const email = user?.primaryEmailAddress?.emailAddress;
  const dbUser = currentUserQuery.data;

  return (
    <Screen>
      <Heading subtitle={email ?? undefined}>Profile</Heading>
      <Card>
        <View style={styles.profileRow}>
          {user?.imageUrl ? (
            <Image source={{ uri: user.imageUrl }} style={styles.avatar} />
          ) : null}
          <View style={styles.profileText}>
            <Text style={styles.cardTitle}>{displayName}</Text>
            {dbUser?.username ? (
              <Text style={styles.bodyText}>@{dbUser.username}</Text>
            ) : (
              <Text style={styles.bodyText}>
                Complete onboarding to create your WIG profile.
              </Text>
            )}
          </View>
        </View>

        {!dbUser ? (
          <Button variant="secondary" onPress={() => router.push("/onboarding")}>
            Complete profile
          </Button>
        ) : null}

        <Button
          variant="ghost"
          onPress={async () => {
            await signOut();
            router.replace("/(tabs)/feed");
          }}
        >
          Sign out
        </Button>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: 28,
    height: 56,
    width: 56,
  },
  bodyText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    lineHeight: 22,
  },
  cardTitle: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 24,
  },
  profileRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  profileText: {
    flex: 1,
    gap: 4,
  },
});
