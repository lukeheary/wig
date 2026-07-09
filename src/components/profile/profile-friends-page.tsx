"use client";

import Link from "next/link";
import { Loader2, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import { PageContainer } from "@/components/shared/page-container";
import { Card, CardContent } from "@/components/ui/card";
import { UserList } from "@/components/user-list";

type ProfileFriendsPageProps = {
  username: string;
  isOwnProfileRoute?: boolean;
};

function displayName(profile: {
  firstName: string | null;
  lastName: string | null;
  username: string;
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
  const { data, isLoading, isError } = trpc.user.getProfileByUsername.useQuery({
    username,
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
    isOwnProfileRoute || profile.isCurrentUser ? "My Friends" : `${name}'s Friends`;

  return (
    <PageContainer>
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
    </PageContainer>
  );
}
