import { useState } from "react";
import { Alert, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { Screen } from "../components/screen";
import { Button, Card, FieldLabel, Heading, Input } from "../components/ui";
import { US_STATES } from "../lib/mobile-utils";
import { onboardingProfileSchema } from "../lib/mobile-validation";
import { trpc } from "../lib/trpc";

export default function OnboardingScreen() {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const [username, setUsername] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("NY");
  const [gender, setGender] = useState<"male" | "female" | "other">("other");
  const updateUsernameMutation = trpc.user.updateUsername.useMutation({
    onSuccess: () => router.replace("/(tabs)/feed"),
    onError: (error: any) =>
      Alert.alert("Profile update failed", error.message ?? "Try again."),
  });

  function submit() {
    const parsed = onboardingProfileSchema.safeParse({
      username,
      city,
      state,
      gender,
    });

    if (!parsed.success) {
      Alert.alert("Profile needs a little more", parsed.error.issues[0]?.message);
      return;
    }

    if (!isSignedIn) {
      router.replace("/(auth)");
      return;
    }

    updateUsernameMutation.mutate(parsed.data);
  }

  return (
    <Screen>
      <Heading subtitle="Choose the profile details WIG uses for friends, RSVPs, and recommendations.">
        Complete your profile
      </Heading>
      <Card>
        <View>
          <FieldLabel>Username</FieldLabel>
          <Input
            value={username}
            onChangeText={(value) => setUsername(value.toLowerCase())}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View>
          <FieldLabel>City</FieldLabel>
          <Input value={city} onChangeText={setCity} />
        </View>
        <View>
          <FieldLabel>State</FieldLabel>
          <Input
            value={state}
            onChangeText={(value) => setState(value.toUpperCase())}
            autoCapitalize="characters"
            maxLength={2}
            placeholder={US_STATES[31].value}
          />
        </View>
        <View>
          <FieldLabel>Gender</FieldLabel>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {(["male", "female", "other"] as const).map((value) => (
              <Button
                key={value}
                variant={gender === value ? "primary" : "secondary"}
                onPress={() => setGender(value)}
              >
                {value}
              </Button>
            ))}
          </View>
        </View>
        <Button onPress={submit} loading={updateUsernameMutation.isPending}>
          Continue to feed
        </Button>
      </Card>
    </Screen>
  );
}
