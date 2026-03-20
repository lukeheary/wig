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
  size?: "sm" | "md" | "lg";
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
  const remainingCount = users.length - maxDisplay;

  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };

  const sizePixels = {
    sm: 24,
    md: 32,
    lg: 40,
  };

  const sizeClass = sizeClasses[size];
  const avatarSize = sizePixels[size];

  if (users.length === 0) {
    return null;
  }

  return (
    <div className={`flex items-center -space-x-2 ${className}`}>
      <div className="flex -space-x-2">
        {displayedUsers.map((user) => {
          const rsvpIndicatorClassName =
            user.rsvpStatus === "interested"
              ? "bg-yellow-400 p-[1px]"
              : user.rsvpStatus === "going"
                ? "bg-neon-teal p-[1px]"
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
                  ? { width: avatarSize + 4, height: avatarSize + 4 }
                  : undefined
              }
            >
              <UserAvatar
                src={user.avatarImageUrl}
                name={user.firstName}
                size={avatarSize}
                className={cn(
                  "h-full w-full",
                  "border border-background bg-background"
                )}
              />
            </div>
          );
        })}
      </div>
      {remainingCount > 0 && (
        <div
          className={`ml-1 flex ${sizeClass} z-10 items-center justify-center rounded-full border border-background bg-muted text-xs text-white`}
        >
          +{remainingCount}
        </div>
      )}
    </div>
  );
}
