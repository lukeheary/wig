"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const MOBILE_AVATAR_COLORS = [
  "#e07a5c",
  "#e0ad75",
  "#9159b3",
  "#6eb39e",
  "#26a194",
  "#7398bd",
] as const;

function getMobileAvatarColor(
  identityKey: string | null | undefined,
  name: string
) {
  const trimmedIdentityKey = identityKey?.trim();
  const key = trimmedIdentityKey || name;
  let hash = BigInt(0);

  for (const scalar of key) {
    hash = BigInt.asIntN(
      64,
      hash * BigInt(31) + BigInt(scalar.codePointAt(0) ?? 0)
    );
  }

  const positiveHash = hash < BigInt(0) ? -hash : hash;
  return MOBILE_AVATAR_COLORS[
    Number(positiveHash % BigInt(MOBILE_AVATAR_COLORS.length))
  ];
}

interface UserAvatarProps {
  src?: string | null;
  name?: string | null;
  identityKey?: string | null;
  className?: string;
  size?: number;
}

export function UserAvatar({
  src,
  name,
  identityKey,
  className,
}: UserAvatarProps) {
  const fallbackName = name || "User";
  const fallbackInitial = Array.from(fallbackName)[0]?.toUpperCase() || "J";
  const fallbackColor = getMobileAvatarColor(identityKey, fallbackName);

  // Filter out Clerk default and OAuth proxy images so the native-style fallback is used instead.
  const isDefaultImage =
    src?.includes("default-user-image") ||
    src?.includes("gravatar.com/avatar") ||
    src?.includes("img.clerk.com");
  const avatarSrc = isDefaultImage ? undefined : src || undefined;

  return (
    <Avatar className={cn("shrink-0 overflow-hidden", className)}>
      <AvatarImage src={avatarSrc} className="h-full w-full object-cover" />
      <AvatarFallback
        className="overflow-hidden rounded-full border-none p-0"
        style={{ backgroundColor: fallbackColor }}
      >
        <svg
          viewBox="0 0 100 100"
          aria-hidden="true"
          className="block h-full w-full"
        >
          <text
            x="50"
            y="52"
            dominantBaseline="middle"
            textAnchor="middle"
            fill="rgba(0, 0, 0, 0.86)"
            fontSize="34"
            fontWeight="700"
          >
            {fallbackInitial}
          </text>
        </svg>
      </AvatarFallback>
    </Avatar>
  );
}
