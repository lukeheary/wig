import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "../components/screen";
import { Button, Card, FieldLabel, Heading, Input } from "../components/ui";
import { US_STATES } from "../lib/mobile-utils";
import { onboardingProfileSchema } from "../lib/mobile-validation";

export default function OnboardingScreen() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("NY");
  const [gender, setGender] = useState<"male" | "female" | "other">("other");

  function submit() {
    const parsed = onboardingProfileSchema.safeParse({
      username,
      city,
      state,
      gender,
    });

    if (!parsed.success) {
      return;
    }

    router.replace("/(tabs)/feed");
  }

  return (
    <Screen>
      <Heading subtitle="This screen stays in place for future native onboarding, but currently just captures the shape of the profile flow and then returns you to the public feed.">
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
        <Button onPress={submit}>Continue to feed</Button>
      </Card>
    </Screen>
  );
}
