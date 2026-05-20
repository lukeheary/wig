import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import { View } from "react-native";

export default function IndexPage() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <View style={{ flex: 1 }} />;
  }

  return <Redirect href={isSignedIn ? "/(tabs)/feed" : "/(auth)"} />;
}
