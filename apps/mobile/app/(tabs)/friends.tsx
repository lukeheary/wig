import { Text } from "react-native";
import { Screen } from "../../components/screen";
import { Card, Heading } from "../../components/ui";
import { mobileTheme } from "../../lib/theme";

export default function FriendsScreen() {
  return (
    <Screen>
      <Heading subtitle="Friends activity will sit here once the native auth layer comes back in. For this first Expo-safe pass, the tab is in place so the mobile app structure matches WIG more closely.">
        Friends
      </Heading>

      <Card>
        <Text
          style={{
            color: mobileTheme.colors.foreground,
            fontFamily: mobileTheme.fonts.displayBold,
            fontSize: 24,
          }}
        >
          Friend activity is coming next
        </Text>
        <Text
          style={{
            color: mobileTheme.colors.mutedForeground,
            fontFamily: mobileTheme.fonts.bodyRegular,
            lineHeight: 22,
          }}
        >
          The navigation is now aligned with the web/mobile-web IA, while the
          feed stays public and stable in Expo.
        </Text>
      </Card>
    </Screen>
  );
}
