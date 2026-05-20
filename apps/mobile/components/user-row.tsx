import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "./ui";
import { mobileTheme } from "../lib/theme";
import type { FriendUser } from "../types/api";

type UserRowProps = {
  user: FriendUser;
  subtitle?: string;
  actionLabel?: string;
  actionVariant?: "primary" | "secondary" | "ghost";
  actionDisabled?: boolean;
  secondaryActionLabel?: string;
  onPressAction?: () => void;
  onPressSecondaryAction?: () => void;
};

function getInitials(user: FriendUser) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();

  if (fullName) {
    return fullName
      .split(" ")
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }

  return (user.username?.slice(0, 2) ?? "?").toUpperCase();
}

export function UserRow({
  user,
  subtitle,
  actionLabel,
  actionVariant = "primary",
  actionDisabled = false,
  secondaryActionLabel,
  onPressAction,
  onPressSecondaryAction,
}: UserRowProps) {
  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    user.email ||
    "WIG user";

  return (
    <View style={styles.row}>
      {user.avatarImageUrl ? (
        <Image source={{ uri: user.avatarImageUrl }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarFallbackText}>{getInitials(user)}</Text>
        </View>
      )}

      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>
          {fullName}
        </Text>
        {user.username ? (
          <Text style={styles.handle} numberOfLines={1}>
            @{user.username}
          </Text>
        ) : null}
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {secondaryActionLabel && onPressSecondaryAction ? (
          <View style={styles.buttonWrap}>
            <Button variant="ghost" onPress={onPressSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          </View>
        ) : null}
        {actionLabel ? (
          <View style={styles.buttonWrap}>
            <Pressable disabled={actionDisabled}>
              <Button
                variant={actionVariant}
                onPress={onPressAction}
                disabled={actionDisabled}
              >
                {actionLabel}
              </Button>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 8,
    marginLeft: 10,
  },
  avatar: {
    borderRadius: 24,
    height: 48,
    width: 48,
  },
  avatarFallback: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.muted,
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  avatarFallbackText: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 14,
  },
  buttonWrap: {
    minWidth: 92,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  handle: {
    color: mobileTheme.colors.accent,
    fontFamily: mobileTheme.fonts.bodyMedium,
    fontSize: 13,
  },
  name: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayMedium,
    fontSize: 16,
  },
  row: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.card,
    borderColor: mobileTheme.colors.border,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  subtitle: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
});
