"use client";

import { Loader2 } from "lucide-react";
import { ProfileFriendsPage } from "@/components/profile/profile-friends-page";
import { trpc } from "@/lib/trpc";

export default function MyProfileFriendsPage() {
  const { data: user, isLoading, isError } = trpc.user.getCurrentUser.useQuery();

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="container mx-auto py-12 text-center text-muted-foreground">
        Error loading friends. Please try again.
      </div>
    );
  }

  return <ProfileFriendsPage username={user.username} isOwnProfileRoute />;
}
