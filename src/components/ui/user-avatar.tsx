"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Facehash } from "facehash";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  src?: string | null;
  name?: string | null;
  className?: string;
  size?: number;
}

export function UserAvatar({
  src,
  name,
  className,
  size = 256,
}: UserAvatarProps) {
  // Filter out Clerk default and OAuth proxy images so Facehash is used instead
  const isDefaultImage =
    src?.includes("default-user-image") ||
    src?.includes("gravatar.com/avatar") ||
    src?.includes("img.clerk.com");
  const avatarSrc = isDefaultImage ? undefined : src || undefined;

  return (
    <Avatar className={cn("shrink-0 overflow-hidden", className)}>
      <AvatarImage src={avatarSrc} className="h-full w-full object-cover" />
      <AvatarFallback className="overflow-hidden rounded-full border-none bg-transparent p-0">
        <Facehash
          name={name || "User"}
          size={size}
          className="block h-full w-full overflow-hidden rounded-full"
          variant="solid"
          colors={[
            // Blues
            "#457B9D", // muted blue
            "#5A7FA6", // soft sky blue
            "#3A5F7D", // deep steel blue

            // Purples
            "#6D597A", // dusty purple
            "#9A6FB0", // soft lavender
            "#B5838D", // mauve rose

            // Greens
            "#2A9D8F", // teal green
            "#6FAF9A", // sage green
            "#4F8A7A", // deep jade

            // Warm tones
            "#F4A261", // warm orange
            "#E9C46A", // warm sand yellow
            "#DDB892", // tan gold
            "#F6BD60", // honey yellow

            // Reds / Corals
            "#E76F51", // coral red
            "#C8553D", // brick red
            "#D77A61", // soft terracotta
          ]}
        />
      </AvatarFallback>
    </Avatar>
  );
}
