import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";

interface User {
  id: string;
  avatarImageUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  rsvpStatus?: "going" | "interested";
}

interface AvatarStackProps {
  users: User[];
  maxDisplay?: number;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function AvatarStack({
  users,
  maxDisplay = 5,
  size = "md",
  className = "",
}: AvatarStackProps) {
  const displayedUsers = [...users]
    .sort((a, b) => {
      const aPriority = a.rsvpStatus === "going" ? 1 : 0;
      const bPriority = b.rsvpStatus === "going" ? 1 : 0;
      return aPriority - bPriority;
    })
    .slice(0, maxDisplay);
  const remainingCount = Math.max(0, users.length - displayedUsers.length);

  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
    xl: "h-11 w-11",
  };

  const sizePixels = {
    sm: 24,
    md: 32,
    lg: 40,
    xl: 44,
  };

  const sizeClass = sizeClasses[size];
  const avatarSize = sizePixels[size];

  if (users.length === 0) {
    return null;
  }

  const overlapClass =
    size === "xl"
      ? "-space-x-4"
      : size === "lg"
        ? "-space-x-2.5"
        : "-space-x-2";
  const overflowTextClass =
    size === "lg" || size === "xl" ? "text-[13px]" : "text-[11px]";

  return (
    <div className={`flex items-center ${overlapClass} ${className}`}>
      <div className={`flex ${overlapClass}`}>
        {displayedUsers.map((user) => {
          const rsvpIndicatorClassName =
            user.rsvpStatus === "interested"
              ? "bg-yellow-400 p-[2px]"
              : user.rsvpStatus === "going"
                ? "bg-neon-teal p-[2px]"
                : "";

          return (
            <div
              key={user.id}
              className={cn(
                "relative rounded-full",
                sizeClass,
                rsvpIndicatorClassName
              )}
              style={
                user.rsvpStatus
                  ? { width: avatarSize + 2, height: avatarSize + 2 }
                  : undefined
              }
            >
              <UserAvatar
                src={user.avatarImageUrl}
                name={user.firstName}
                identityKey={user.id}
                size={avatarSize}
                className="h-full w-full border-0 bg-transparent"
              />
            </div>
          );
        })}
      </div>
      {remainingCount > 0 && (
        <div
          className={cn(
            "z-10 flex items-center justify-center rounded-full border border-white/15 bg-black/50 font-bold text-white backdrop-blur-xl",
            sizeClass,
            overflowTextClass
          )}
        >
          +{remainingCount}
        </div>
      )}
    </div>
  );
}
