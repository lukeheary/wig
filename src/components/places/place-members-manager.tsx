"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ResponsiveSelect } from "@/components/ui/responsive-select";
import { useToast } from "@/hooks/use-toast";
import { X, Plus } from "lucide-react";

interface PlaceMembersManagerProps {
  placeId: string;
  placeName?: string;
  placeType?: "venue" | "organizer";
  /** Whether to show the card wrapper or just the content */
  showCard?: boolean;
  /** Whether to show the title header */
  showTitle?: boolean;
  /** Custom title text */
  title?: string;
  /** Custom description text */
  description?: string;
  /** Whether the user can add/remove members */
  canManage?: boolean;
}

type PlaceMemberRole = "owner" | "manager" | "promoter" | "staff";

export function PlaceMembersManager({
  placeId,
  placeName,
  placeType = "venue",
  showCard = true,
  showTitle = true,
  title = "Team Members",
  description,
  canManage = true,
}: PlaceMembersManagerProps) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [userSearch, setUserSearch] = useState("");
  const [selectedRole, setSelectedRole] = useState<PlaceMemberRole>("staff");

  const { data: placeMembers } = trpc.place.getPlaceMembers.useQuery(
    { placeId },
    { enabled: !!placeId }
  );

  const { data: searchedUsers } = trpc.admin.searchUsers.useQuery(
    { query: userSearch },
    { enabled: canManage && userSearch.length >= 2 }
  );

  const addPlaceMemberMutation = trpc.admin.addPlaceMember.useMutation({
    onSuccess: () => {
      toast({ title: "Success", description: "Member added" });
      utils.place.getPlaceMembers.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removePlaceMemberMutation = trpc.admin.removePlaceMember.useMutation({
    onSuccess: () => {
      toast({ title: "Success", description: "Member removed" });
      utils.place.getPlaceMembers.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddMember = (userId: string) => {
    addPlaceMemberMutation.mutate({ placeId, userId, role: selectedRole });
    setUserSearch("");
  };

  const handleRemoveMember = (userId: string) => {
    removePlaceMemberMutation.mutate({ placeId, userId });
  };

  const typeLabel = placeType === "venue" ? "venue" : "organizer";
  const defaultDescription = `People who can manage this ${typeLabel}`;
  const roleOptions = [
    { value: "owner", label: "Owner" },
    { value: "manager", label: "Manager" },
    { value: "promoter", label: "Promoter" },
    { value: "staff", label: "Staff" },
  ];

  const content = (
    <div className="space-y-4">
      {/* Current Members List */}
      <div className="space-y-2">
        {placeMembers?.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-lg border p-3"
          >
            <div className="flex items-center gap-3">
              <UserAvatar
                src={member.user.avatarImageUrl}
                name={
                  `${member.user.firstName || ""} ${member.user.lastName || ""}`.trim() ||
                  member.user.username
                }
                identityKey={member.user.id}
                className="h-10 w-10"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {`${member.user.firstName || ""} ${member.user.lastName || ""}`.trim() ||
                    member.user.username ||
                    member.user.email}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.user.username
                    ? `@${member.user.username}`
                    : member.user.email}
                </p>
              </div>
            </div>
            {canManage && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemoveMember(member.userId)}
                disabled={removePlaceMemberMutation.isPending}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        {!placeMembers?.length && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No team members yet
          </p>
        )}
      </div>

      {/* Add Member Search */}
      {canManage && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Add Team Member</p>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Role</p>
            <ResponsiveSelect
              value={selectedRole}
              onValueChange={(value) =>
                setSelectedRole(value as PlaceMemberRole)
              }
              options={roleOptions}
              placeholder="Select a role"
              title="Select role"
            />
          </div>
          <Input
            placeholder="Search users by name or email..."
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
          />
          {searchedUsers && searchedUsers.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border">
              {searchedUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-2 hover:bg-muted/50"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <UserAvatar
                      src={user.avatarImageUrl}
                      name={
                        `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
                        user.username
                      }
                      identityKey={user.id}
                      className="h-8 w-8"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {`${user.firstName || ""} ${user.lastName || ""}`.trim() ||
                          user.username}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user.username ? `@${user.username}` : user.email}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAddMember(user.id)}
                    disabled={addPlaceMemberMutation.isPending}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (!showCard) {
    return content;
  }

  return (
    <Card>
      {showTitle && (
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{title}</CardTitle>
          {(description || defaultDescription) && (
            <p className="text-sm text-muted-foreground">
              {description || defaultDescription}
            </p>
          )}
        </CardHeader>
      )}
      <CardContent className={showTitle ? "space-y-4" : "space-y-4 pt-6"}>
        {content}
      </CardContent>
    </Card>
  );
}
