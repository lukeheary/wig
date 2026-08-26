import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export interface UserListUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  avatarImageUrl: string | null;
}

interface UserListProps<T> {
  items: T[];
  getUser: (item: T) => UserListUser;
  renderAction?: (item: T) => ReactNode;
  renderBadges?: (item: T) => ReactNode;
  className?: string;
  emptyMessage?: ReactNode;
  onItemClick?: (item: T) => void;
}

export function UserList<T>({
  items,
  getUser,
  renderAction,
  renderBadges,
  className,
  emptyMessage,
  onItemClick,
}: UserListProps<T>) {
  if (items.length === 0 && emptyMessage) {
    return <>{emptyMessage}</>;
  }

  return (
    <div className={cn("flex flex-col divide-y", className)}>
      {items.map((item, index) => {
        const user = getUser(item);
        return (
          <div
            key={user.id || index}
            className={cn(
              "flex items-center justify-between py-4 first:pt-0 last:pb-0",
              onItemClick && "cursor-pointer hover:bg-muted/50"
            )}
            onClick={() => onItemClick?.(item)}
          >
            <div className="flex items-center gap-3">
              <UserAvatar
                src={user.avatarImageUrl}
                name={user.firstName}
                identityKey={user.id}
              />
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {user.firstName} {user.lastName}
                  </p>
                  {renderBadges && renderBadges(item)}
                </div>
                <p className="text-sm text-muted-foreground">
                  @{user.username}
                </p>
              </div>
            </div>
            {renderAction && <div>{renderAction(item)}</div>}
          </div>
        );
      })}
    </div>
  );
}
