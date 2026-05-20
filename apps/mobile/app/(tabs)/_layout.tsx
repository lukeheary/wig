import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { mobileTheme } from "../../lib/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        ...(Platform.OS === "ios"
          ? {
              tabBarActiveTintColor: mobileTheme.colors.foreground,
              tabBarInactiveTintColor: mobileTheme.colors.mutedForeground,
            }
          : {
              headerShadowVisible: false,
              headerStyle: { backgroundColor: mobileTheme.colors.background },
              headerTintColor: mobileTheme.colors.foreground,
              headerTitleStyle: {
                fontFamily: mobileTheme.fonts.displayMedium,
              },
              tabBarStyle: {
                backgroundColor: mobileTheme.colors.card,
                borderTopColor: mobileTheme.colors.border,
              },
              tabBarLabelStyle: {
                fontFamily: mobileTheme.fonts.bodyMedium,
              },
              tabBarActiveTintColor: mobileTheme.colors.accent,
              tabBarInactiveTintColor: mobileTheme.colors.mutedForeground,
            }),
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen
        name="venue"
        options={{
          title: "Venues",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="business-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: "Friends",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
