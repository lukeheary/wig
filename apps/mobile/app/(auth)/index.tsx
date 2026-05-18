import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "../../components/screen";
import { mobileTheme } from "../../lib/theme";
import {
  Button,
  Card,
  FieldLabel,
  Heading,
  Input,
  Pill,
} from "../../components/ui";

type Mode = "sign-in" | "sign-up";

export default function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);

  const isReady = useMemo(() => true, []);

  async function handleSubmit() {
    if (!isReady) return;

    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      router.replace(mode === "sign-up" ? "/onboarding" : "/(tabs)/feed");
    }, 250);
  }

  return (
    <Screen>
      <Heading subtitle="Public mobile preview for WIG. Native auth is temporarily disabled in this build so the Expo app can run cleanly while we keep using the existing web backend.">
        Who Is Going
      </Heading>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pill active={mode === "sign-in"} onPress={() => setMode("sign-in")}>
          Browse
        </Pill>
        <Pill active={mode === "sign-up"} onPress={() => setMode("sign-up")}>
          Profile setup
        </Pill>
      </View>

      <Card>
        {mode === "sign-up" ? (
          <>
            <View>
              <FieldLabel>First name</FieldLabel>
              <Input
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
              />
            </View>
            <View>
              <FieldLabel>Last name</FieldLabel>
              <Input
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
              />
            </View>
          </>
        ) : null}

        <View>
          <FieldLabel>Email</FieldLabel>
          <Input
            value={emailAddress}
            onChangeText={setEmailAddress}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View>
          <FieldLabel>Password</FieldLabel>
          <Input value={password} onChangeText={setPassword} secureTextEntry />
        </View>

        <Button onPress={handleSubmit} loading={loading}>
          {mode === "sign-in" ? "Browse events" : "Continue to setup"}
        </Button>

        <Text
          style={{
            color: mobileTheme.colors.mutedForeground,
            fontFamily: mobileTheme.fonts.bodyRegular,
            lineHeight: 20,
          }}
        >
          The UI stays native, but this first stable build is guest-first so it
          works in Expo without native auth module issues.
        </Text>
      </Card>
    </Screen>
  );
}
