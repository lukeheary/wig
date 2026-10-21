"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const utils = trpc.useUtils();
  const search = trpc.admin.searchUsers.useQuery(
    { query, limit: 20 },
    {
      enabled: query.trim().length > 0,
    }
  );
  const visibility = trpc.admin.setProfileVisibility.useMutation({
    onSuccess: () => utils.admin.searchUsers.invalidate(),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Profile visibility</h1>
        <p className="text-muted-foreground">
          Hide review or test accounts from other users. Hidden accounts can
          still sign in and use WIG. Their profiles, RSVPs, and activity are
          hidden from others, and they cannot send friend or partner requests.
        </p>
      </header>
      <Input
        aria-label="Search users"
        placeholder="Search by name, username, or email"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {(search.error || visibility.error) && (
        <p role="alert" className="text-destructive">
          {search.error?.message ?? visibility.error?.message}
        </p>
      )}
      {search.isFetching && <p role="status">Loading users…</p>}
      {search.data?.length === 0 && <p>No matching users.</p>}
      <ul className="space-y-3">
        {search.data?.map((user) => (
          <li
            key={user.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4"
          >
            <div>
              <p className="font-semibold">
                {[user.firstName, user.lastName].filter(Boolean).join(" ") ||
                  user.username}
              </p>
              <p className="text-sm text-muted-foreground">
                @{user.username} · {user.email}
              </p>
              <p className="text-sm">
                {user.isProfileHidden ? "Hidden from other users" : "Visible"}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={visibility.isPending}
              onClick={() =>
                visibility.mutate({
                  userId: user.id,
                  hidden: !user.isProfileHidden,
                })
              }
            >
              {user.isProfileHidden ? "Make visible" : "Hide profile"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
