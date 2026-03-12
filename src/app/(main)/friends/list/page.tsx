"use client";

import { Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Users, Loader2 } from "lucide-react";
import { UserList } from "@/components/user-list";
import { BackButtonHeader } from "@/components/shared/back-button-header";

function FriendsListContent() {
  const { data: friends, isLoading } = trpc.friends.listFriends.useQuery({});
  const acceptedFriends = friends?.filter((f) => f.status === "accepted") || [];

  return (
    <div className="container mx-auto space-y-4 pb-4">
      <BackButtonHeader backHref="/friends" title="My Friends" />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : acceptedFriends.length === 0 ? (
        <div className="py-12 text-center">
          <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="mb-2 text-muted-foreground">
            You don&apos;t have any friends yet
          </p>
          <p className="text-sm text-muted-foreground">
            Use the Find Friends page to connect with people
          </p>
        </div>
      ) : (
        <UserList
          items={acceptedFriends}
          getUser={(friend) => ({
            id: friend.friend?.id || "",
            firstName: friend.friend?.firstName || null,
            lastName: friend.friend?.lastName || null,
            username: friend.friend?.username || null,
            avatarImageUrl: friend.friend?.avatarImageUrl || null,
          })}
          renderAction={() => <Badge variant="outline">Friends</Badge>}
        />
      )}
    </div>
  );
}

export default function FriendsListPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto py-8">
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      }
    >
      <FriendsListContent />
    </Suspense>
  );
}
