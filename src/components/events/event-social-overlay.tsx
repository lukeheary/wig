import { type SocialUser } from "@/components/events/event-card-helpers";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { cn } from "@/lib/utils";

interface EventSocialOverlayProps {
  users: SocialUser[];
  size: "md" | "lg";
  maxDisplay?: number;
  placement?: "bottom-right" | "top-center" | "top-right";
  stackClassName?: string;
}

export function EventSocialOverlay({
  users,
  size,
  maxDisplay = 3,
  placement = "bottom-right",
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
  const isTopCenter = placement === "top-center";
  const isTopRight = placement === "top-right";

  return (
    <>
      {!isTopCenter && !isTopRight && (
        <div
          className="pointer-events-none absolute bottom-0 right-0"
          style={{
            width: `${scrimWidth}px`,
            height: `${scrimHeight}px`,
            backgroundImage:
              "radial-gradient(ellipse at 100% 100%, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.62) 22%, rgba(0,0,0,0.32) 46%, rgba(0,0,0,0.08) 64%, transparent 78%)",
          }}
        />
      )}
      <div
        className={cn(
          isTopCenter
            ? "absolute left-1/2 top-4 z-20 -translate-x-1/2 drop-shadow-[0_8px_22px_rgba(0,0,0,0.45)]"
            : isTopRight
              ? "absolute right-2 top-2 z-20 drop-shadow-[0_8px_22px_rgba(0,0,0,0.45)]"
              : "absolute bottom-2 right-2 drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]",
          stackClassName
        )}
      >
        <AvatarStack
          users={users.map(({ rsvpStatus: _rsvpStatus, ...user }) => user)}
          maxDisplay={maxDisplay}
          size={size}
        />
      </div>
    </>
  );
}
