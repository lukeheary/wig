"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Users, Loader2, ChevronRight } from "lucide-react";
import { UserList } from "@/components/user-list";
import { Card, CardContent } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { StickySearchBar } from "@/components/ui/sticky-search-bar";
import pluralize from "pluralize";

function FriendsListContent() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: friends, isLoading } = trpc.friends.listFriends.useQuery({});
  const acceptedFriends = friends?.filter((f) => f.status === "accepted") || [];
  const pendingRequests =
    friends?.filter((f) => f.status === "pending" && !f.isSender) || [];
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
    <div className="container mx-auto pb-8 pt-4">
      <StickySearchBar>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search your friends..."
          showBack
          onBack={() => router.push("/friends")}
          className="w-full"
        />

        <div className="flex w-full shrink-0 gap-2 sm:w-auto">
          <div className="flex-1 sm:w-32 sm:flex-none lg:w-40">
            <div className="flex h-12 items-center justify-between rounded-full bg-muted px-5">
              <p className="flex flex-row items-center gap-1.5 text-base font-medium lg:text-lg">
                <span>{acceptedFriends.length}</span>
                <span className="text-sm text-muted-foreground">
                  {pluralize("Friend", acceptedFriends.length)}
                </span>
              </p>
            </div>
          </div>
          <div className="flex-1 sm:w-32 sm:flex-none lg:w-40">
            <div className="flex h-12 items-center justify-between rounded-full bg-muted px-5">
              <p className="flex flex-row items-center gap-1.5 text-base font-medium lg:text-lg">
                <span>{pendingRequests.length}</span>
                <span className="text-sm text-muted-foreground">
                  {pluralize("Request", pendingRequests.length)}
                </span>
              </p>
              <ChevronRight className="h-4 w-4 text-muted-foreground lg:h-5 lg:w-5" />
            </div>
          </div>
        </div>
      </StickySearchBar>

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
