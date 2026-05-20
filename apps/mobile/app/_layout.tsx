import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import {
  Urbanist_400Regular,
  Urbanist_500Medium,
  Urbanist_700Bold,
  useFonts,
} from "@expo-google-fonts/urbanist";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { AppProviders } from "../lib/trpc";
import { mobileTheme } from "../lib/theme";
import { mobileEnv } from "../lib/env";

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    Urbanist_400Regular,
    Urbanist_500Medium,
    Urbanist_700Bold,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <ClerkProvider
      publishableKey={mobileEnv.clerkPublishableKey ?? ""}
      tokenCache={tokenCache}
    >
      <AppProviders>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            contentStyle: {
              backgroundColor: mobileTheme.colors.background,
            },
            ...(Platform.OS === "ios"
              ? {}
              : {
                  headerShadowVisible: false,
                  headerStyle: {
                    backgroundColor: mobileTheme.colors.background,
                  },
                  headerTintColor: mobileTheme.colors.foreground,
                  headerTitleStyle: {
                    fontFamily: mobileTheme.fonts.displayMedium,
                  },
                }),
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </AppProviders>
    </ClerkProvider>
  );
}
