import { type SocialUser } from "@/components/events/event-card-helpers";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { cn } from "@/lib/utils";

interface EventSocialOverlayProps {
  users: SocialUser[];
  size: "md" | "lg";
  maxDisplay?: number;
  stackClassName?: string;
}

export function EventSocialOverlay({
  users,
  size,
  maxDisplay = 3,
  stackClassName,
}: EventSocialOverlayProps) {
  if (users.length === 0) {
    return null;
  }

  const visibleCount = Math.min(users.length, maxDisplay);
  const hasOverflowBadge = users.length > maxDisplay;
  const avatarSize = size === "lg" ? 40 : 32;
  const overlapOffset = 8;
  const avatarFootprint =
    avatarSize + Math.max(0, visibleCount - 1) * (avatarSize - overlapOffset);
  const overflowFootprint = hasOverflowBadge ? avatarSize + 6 : 0;
  const scrimWidth = avatarFootprint + overflowFootprint + 28;
  const scrimHeight = avatarSize + 44;

  return (
    <>
      <div
        className="pointer-events-none absolute bottom-0 right-0"
        style={{
          width: `${scrimWidth}px`,
          height: `${scrimHeight}px`,
          backgroundImage:
            "radial-gradient(ellipse at 100% 100%, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.62) 22%, rgba(0,0,0,0.32) 46%, rgba(0,0,0,0.08) 64%, transparent 78%)",
        }}
      />
      <div
        className={cn(
          "absolute bottom-2 right-2 drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]",
          stackClassName
        )}
      >
        <AvatarStack users={users} maxDisplay={maxDisplay} size={size} />
      </div>
    </>
  );
}
