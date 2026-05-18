import { Text } from "react-native";
import { Screen } from "../../components/screen";
import { Button, Card, Heading } from "../../components/ui";
import { mobileTheme } from "../../lib/theme";

export default function ProfileScreen() {
  return (
    <Screen>
      <Heading subtitle="Profile is temporarily web-only while native auth is disabled in this Expo-safe build.">
        Profile
      </Heading>
      <Card>
        <Text
          style={{
            fontSize: 24,
            fontFamily: mobileTheme.fonts.displayBold,
            color: mobileTheme.colors.foreground,
          }}
        >
          Profile setup coming next
        </Text>
        <Text
          style={{
            color: mobileTheme.colors.mutedForeground,
            fontFamily: mobileTheme.fonts.bodyRegular,
          }}
        >
          Browse events in native now, then use the web app for account setup and authenticated actions until the native auth layer is reintroduced.
        </Text>
      </Card>
      <Button variant="secondary" onPress={() => {}}>
        Native auth coming soon
      </Button>
    </Screen>
  );
}
