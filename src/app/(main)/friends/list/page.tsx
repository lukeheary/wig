"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Users, Loader2 } from "lucide-react";
import { UserList } from "@/components/user-list";
import { Card, CardContent } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";

function FriendsListContent() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: friends, isLoading } = trpc.friends.listFriends.useQuery({});
  const acceptedFriends = friends?.filter((f) => f.status === "accepted") || [];
  const filteredFriends = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return acceptedFriends;

    return acceptedFriends.filter((friend) => {
      const firstName = friend.friend?.firstName?.toLowerCase() ?? "";
      const lastName = friend.friend?.lastName?.toLowerCase() ?? "";
      const username = friend.friend?.username?.toLowerCase() ?? "";
      const fullName = `${firstName} ${lastName}`.trim();

      return (
        fullName.includes(query) ||
        firstName.includes(query) ||
        lastName.includes(query) ||
        username.includes(query)
      );
    });
  }, [acceptedFriends, searchQuery]);

  return (
    <div className="container mx-auto pb-4">
      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search your friends..."
        showBack
        onBack={() => router.push("/friends")}
        className="w-full pb-4"
      />

      <StickySectionHeader className="-mx-4">
        <h2 className="text-xl font-semibold tracking-tight">My Friends</h2>
      </StickySectionHeader>

      <Card>
        <CardContent className="pt-6">
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
          ) : filteredFriends.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No friends found
            </div>
          ) : (
            <UserList
              items={filteredFriends}
              getUser={(friend) => ({
                id: friend.friend?.id || "",
                firstName: friend.friend?.firstName || null,
                lastName: friend.friend?.lastName || null,
                username: friend.friend?.username || null,
                avatarImageUrl: friend.friend?.avatarImageUrl || null,
              })}
              // renderAction={() => <Badge variant="outline">Friends</Badge>}
            />
          )}
        </CardContent>
      </Card>
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
