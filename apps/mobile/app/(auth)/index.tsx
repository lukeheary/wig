import { useEffect, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { useSSO } from "@clerk/expo";
import { useSignIn, useSignUp } from "@clerk/expo/legacy";
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

function getClerkErrorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error != null &&
    "errors" in error &&
    Array.isArray((error as { errors?: unknown }).errors)
  ) {
    const firstError = (error as { errors: Array<{ message?: string }> })
      .errors[0];

    if (firstError?.message) {
      return firstError.message;
    }
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

export default function AuthScreen() {
  const router = useRouter();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { startSSOFlow } = useSSO();
  const { isLoaded: signInLoaded, signIn, setActive: setSignInActive } =
    useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setSignUpActive } =
    useSignUp();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [loading, setLoading] = useState(false);

  const isReady = useMemo(
    () => (mode === "sign-in" ? signInLoaded : signUpLoaded),
    [mode, signInLoaded, signUpLoaded]
  );

  useEffect(() => {
    setPendingVerification(false);
    setVerificationCode("");
  }, [mode]);

  useEffect(() => {
    if (!authLoaded) return;

    if (isSignedIn) {
      router.replace("/(tabs)/feed");
    }
  }, [authLoaded, isSignedIn, router]);

  async function handleSignIn() {
    if (!signInLoaded || !signIn) return;

    const result = await signIn.create({
      identifier: emailAddress.trim(),
      password,
    });

    if (result.status === "complete") {
      await setSignInActive({ session: result.createdSessionId });
      router.replace("/(tabs)/feed");
      return;
    }

    Alert.alert("More verification needed", "Please finish signing in.");
  }

  async function handleSignUp() {
    if (!signUpLoaded || !signUp) return;

    await signUp.create({
      emailAddress: emailAddress.trim(),
      password,
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
    });

    await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    setPendingVerification(true);
  }

  async function handleVerifySignUp() {
    if (!signUpLoaded || !signUp) return;

    const result = await signUp.attemptEmailAddressVerification({
      code: verificationCode.trim(),
    });

    if (result.status === "complete") {
      await setSignUpActive({ session: result.createdSessionId });
      router.replace("/onboarding");
      return;
    }

    Alert.alert("More verification needed", "Please finish verifying your email.");
  }

  async function handleGoogleSignIn() {
    if (isSignedIn) {
      router.replace("/(tabs)/feed");
      return;
    }

    const result = await startSSOFlow({
      strategy: "oauth_google",
    });

    if (!result.createdSessionId || !result.setActive) {
      return;
    }

    await result.setActive({ session: result.createdSessionId });

    const isNewUser = Boolean(result.signUp?.createdSessionId);
    router.replace(isNewUser ? "/onboarding" : "/(tabs)/feed");
  }

  async function handleSubmit() {
    if (!isReady) return;

    setLoading(true);

    try {
      if (pendingVerification) {
        await handleVerifySignUp();
      } else if (mode === "sign-in") {
        await handleSignIn();
      } else {
        await handleSignUp();
      }
    } catch (error) {
      Alert.alert("Authentication failed", getClerkErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Heading subtitle="Sign in to RSVP, see friend activity, and manage your WIG profile.">
        Who Is Going
      </Heading>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pill active={mode === "sign-in"} onPress={() => setMode("sign-in")}>
          Sign in
        </Pill>
        <Pill active={mode === "sign-up"} onPress={() => setMode("sign-up")}>
          Sign up
        </Pill>
      </View>

      <Card>
        {!pendingVerification ? (
          <>
            <Button
              variant="secondary"
              onPress={async () => {
                setLoading(true);

                try {
                  await handleGoogleSignIn();
                } catch (error) {
                  Alert.alert("Google sign-in failed", getClerkErrorMessage(error));
                } finally {
                  setLoading(false);
                }
              }}
              loading={loading}
            >
              Continue with Google
            </Button>

            <Text style={styles.helperText}>Or use your email below.</Text>
          </>
        ) : null}

        {mode === "sign-up" && !pendingVerification ? (
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

        {!pendingVerification ? (
          <>
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
              <Input
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>
          </>
        ) : (
          <View>
            <FieldLabel>Email verification code</FieldLabel>
            <Input
              value={verificationCode}
              onChangeText={setVerificationCode}
              keyboardType="number-pad"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

        <Button onPress={handleSubmit} loading={loading}>
          {pendingVerification
            ? "Verify email"
            : mode === "sign-in"
              ? "Sign in"
              : "Create account"}
        </Button>

        {pendingVerification ? (
          <Text style={styles.helperText}>
            Enter the code Clerk sent to {emailAddress.trim()}.
          </Text>
        ) : (
          <Button variant="ghost" onPress={() => router.replace("/(tabs)/feed")}>
            Continue as guest
          </Button>
        )}
      </Card>
    </Screen>
  );
}

const styles = {
  helperText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    lineHeight: 20,
  },
};
