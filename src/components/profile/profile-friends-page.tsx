"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MoreHorizontal, UserMinus, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import { PageContainer } from "@/components/shared/page-container";
import { Card, CardContent } from "@/components/ui/card";
import { UserList } from "@/components/user-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { MobileFilterPills } from "@/components/ui/mobile-filter-pills";
import {
  MobileProfileEmpty,
  MobileProfileListHeader,
  MobileProfileUserRow,
} from "@/components/profile/mobile-profile-list";
import type { MobileProfileUser } from "@/components/profile/mobile-profile-list";

type ProfileFriendsPageProps = {
  username: string;
  isOwnProfileRoute?: boolean;
};

function displayName(profile: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}) {
  return (
    [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
    profile.username
  );
}

export function ProfileFriendsPage({
  username,
  isOwnProfileRoute = false,
}: ProfileFriendsPageProps) {
  const [mobileFilter, setMobileFilter] = useState<
    "friends" | "partner" | "blocked"
  >("friends");
  const [friendToRemove, setFriendToRemove] = useState<
    MobileProfileUser | undefined
  >();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { data, isLoading, isError } = trpc.user.getProfileByUsername.useQuery({
    username,
  });
  const isOwnProfile = isOwnProfileRoute || data?.profile.isCurrentUser;
  const { data: partner } = trpc.partners.getMyPartner.useQuery(undefined, {
    enabled: Boolean(isOwnProfile),
  });
  const { data: blockedUsers } = trpc.friends.listBlockedUsers.useQuery(
    undefined,
    { enabled: Boolean(isOwnProfile) }
  );
  const removeFriend = trpc.friends.removeFriend.useMutation({
    onSuccess: async () => {
      setFriendToRemove(undefined);
      await Promise.all([
        utils.user.getProfileByUsername.invalidate({ username }),
        utils.friends.listFriends.invalidate(),
      ]);
    },
    onError: (error) => {
      toast({
        title: "Could not remove friend",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <PageContainer>
        <div className="py-12 text-center text-muted-foreground">
          Friends list not found.
        </div>
      </PageContainer>
    );
  }

  const { profile, friends } = data;
  const name = displayName(profile);
  const profileHref =
    isOwnProfileRoute || profile.isCurrentUser
      ? "/profile"
      : `/${profile.username}`;
  const title =
    isOwnProfileRoute || profile.isCurrentUser
      ? "My Friends"
      : `${name}'s Friends`;

  return (
    <PageContainer className="min-h-screen max-w-5xl bg-black !px-2 !pt-0 md:!px-6 md:!pt-8">
      <div className="md:hidden">
        <MobileProfileListHeader title="Friends" />
        {isOwnProfile ? (
          <MobileFilterPills
            options={[
              { value: "friends", label: "Friends" },
              { value: "partner", label: "Partner" },
              { value: "blocked", label: "Blocked" },
            ]}
            value={mobileFilter}
            onValueChange={setMobileFilter}
            className="mt-4"
          />
        ) : null}

        <div className="mt-4">
          {mobileFilter === "friends" || !isOwnProfile ? (
            friends.length ? (
              friends.map((friend) => (
                <MobileProfileUserRow
                  key={friend.id}
                  user={friend}
                  action={
                    isOwnProfile ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Friend options for ${displayName(friend)}`}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-white/85"
                          >
                            <MoreHorizontal className="h-5 w-5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="min-w-36 border-white/10 bg-[#242426]/95 backdrop-blur-2xl"
                        >
                          <DropdownMenuItem
                            className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
                            onSelect={() => setFriendToRemove(friend)}
                          >
                            <UserMinus />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : undefined
                  }
                />
              ))
            ) : (
              <MobileProfileEmpty>No friends yet</MobileProfileEmpty>
            )
          ) : mobileFilter === "partner" ? (
            partner?.status === "accepted" && partner.partner ? (
              <MobileProfileUserRow user={partner.partner} />
            ) : (
              <MobileProfileEmpty>No partner yet</MobileProfileEmpty>
            )
          ) : blockedUsers?.length ? (
            blockedUsers.map((user) => (
              <MobileProfileUserRow key={user.id} user={user} />
            ))
          ) : (
            <MobileProfileEmpty>No blocked users</MobileProfileEmpty>
          )}
        </div>
      </div>

      <div className="hidden md:block">
        <BackButtonHeader backHref={profileHref} title={title} />

        <Card>
          <CardContent className="pt-6">
            {friends.length === 0 ? (
              <EmptyStateCard
                icon={Users}
                title="No friends yet"
                description="Friends will show up here once they connect."
                showCard={false}
              />
            ) : (
              <UserList
                items={friends}
                getUser={(friend) => friend}
                onItemClick={() => undefined}
                renderAction={(friend) =>
                  friend.username ? (
                    <Link
                      href={`/${friend.username}`}
                      className="text-sm font-medium text-primary hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      View
                    </Link>
                  ) : null
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={Boolean(friendToRemove)}
        onOpenChange={(open) => {
          if (!open && !removeFriend.isPending) setFriendToRemove(undefined);
        }}
      >
        <DialogContent className="w-[calc(100%-2rem)] rounded-[1.75rem] border-white/10 bg-[#1d1d20] p-5 text-white sm:max-w-sm">
          <DialogHeader className="text-left">
            <DialogTitle>Remove friend?</DialogTitle>
            <DialogDescription className="text-white/55">
              Are you sure you want to remove{" "}
              {friendToRemove ? displayName(friendToRemove) : "this friend"}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 flex-row justify-end gap-2 space-x-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFriendToRemove(undefined)}
              disabled={removeFriend.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (friendToRemove) {
                  removeFriend.mutate({ friendUserId: friendToRemove.id });
                }
              }}
              disabled={!friendToRemove || removeFriend.isPending}
            >
              {removeFriend.isPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
