import { PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
} from "react-native";
import { mobileTheme } from "../lib/theme";

export function Heading({
  children,
  subtitle,
}: PropsWithChildren<{ subtitle?: string }>) {
  return (
    <View style={styles.headingWrap}>
      <Text style={styles.heading}>{children}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function FieldLabel({ children }: PropsWithChildren) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={mobileTheme.colors.mutedForeground}
      style={styles.input}
      {...props}
    />
  );
}

export function Button({
  children,
  variant = "primary",
  loading = false,
  ...props
}: PropsWithChildren<
  PressableProps & {
    variant?: "primary" | "secondary" | "ghost";
    loading?: boolean;
  }
>) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        variant === "secondary" && styles.buttonSecondary,
        variant === "ghost" && styles.buttonGhost,
        pressed && styles.buttonPressed,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          color={
            variant === "primary"
              ? mobileTheme.colors.primaryForeground
              : mobileTheme.colors.foreground
          }
        />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant !== "primary" && styles.buttonTextSecondary,
          ]}
        >
          {children}
        </Text>
      )}
    </Pressable>
  );
}

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

export function Pill({
  children,
  active = false,
  onPress,
}: PropsWithChildren<{ active?: boolean; onPress?: () => void }>) {
  return (
    <Pressable
      style={[styles.pill, active && styles.pillActive]}
      onPress={onPress}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headingWrap: {
    gap: 6,
  },
  heading: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 30,
  },
  subtitle: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
  },
  label: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: mobileTheme.colors.border,
    backgroundColor: mobileTheme.colors.input,
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  button: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.primary,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  buttonSecondary: {
    backgroundColor: mobileTheme.colors.muted,
  },
  buttonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: mobileTheme.colors.border,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: mobileTheme.colors.primaryForeground,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 15,
  },
  buttonTextSecondary: {
    color: mobileTheme.colors.foreground,
  },
  card: {
    backgroundColor: mobileTheme.colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: mobileTheme.colors.border,
    gap: 12,
  },
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: mobileTheme.colors.muted,
  },
  pillActive: {
    backgroundColor: mobileTheme.colors.accent,
  },
  pillText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 13,
  },
  pillTextActive: {
    color: mobileTheme.colors.background,
  },
});
