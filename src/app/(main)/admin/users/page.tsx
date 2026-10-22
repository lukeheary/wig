"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

export default function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const [sourceSettingsUserId, setSourceSettingsUserId] = useState<
    string | null
  >(null);
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
        <h1 className="text-3xl font-bold">User controls</h1>
        <p className="text-muted-foreground">
          Hide review or test accounts from other users. Hidden accounts can
          still sign in and use WIG. Their profiles, RSVPs, and activity are
          hidden from others, and they cannot send friend or partner requests.
          You can also choose which event sources each account sees.
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
            <div className="flex gap-2">
              <Button
                variant="outline"
                aria-expanded={sourceSettingsUserId === user.id}
                onClick={() =>
                  setSourceSettingsUserId(
                    sourceSettingsUserId === user.id ? null : user.id
                  )
                }
              >
                Event sources
              </Button>
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
            </div>
            {sourceSettingsUserId === user.id && (
              <AccountEventSources
                key={user.id}
                userId={user.id}
                username={user.username}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const sourceTitles = {
  ticketmaster: "Ticketmaster",
  eventbrite: "Eventbrite",
  posh: "Posh",
  dice: "Dice",
};

function AccountEventSources({
  userId,
  username,
}: {
  userId: string;
  username: string;
}) {
  const utils = trpc.useUtils();
  const settings = trpc.admin.getUserEventSources.useQuery({ userId });
  const save = trpc.admin.setUserEventSourceVisibility.useMutation({
    onSuccess: () => utils.admin.getUserEventSources.invalidate({ userId }),
  });
  return (
    <section
      className="w-full space-y-4 border-t pt-4"
      aria-label={`Event sources for ${username}`}
    >
      <p className="text-sm text-muted-foreground">
        Choose sources to hide from @{username}. This affects this account only,
        across Home, search, event pages, profiles, and activity. Changes appear
        when the app refreshes.
      </p>
      {settings.isLoading && <p role="status">Loading sources…</p>}
      {(settings.error || save.error) && (
        <p role="alert" className="text-destructive">
          {settings.error?.message ?? save.error?.message}
        </p>
      )}
      {settings.data?.map((setting) => (
        <div
          key={setting.source}
          className="flex items-center justify-between gap-4"
        >
          <label htmlFor={`source-${userId}-${setting.source}`}>
            Hide {sourceTitles[setting.source]}
            {setting.globallyHidden && (
              <span className="block text-xs text-muted-foreground">
                Also hidden globally. Change global visibility separately to
                show it to other accounts.
              </span>
            )}
          </label>
          <Switch
            id={`source-${userId}-${setting.source}`}
            checked={setting.hidden}
            disabled={save.isPending || settings.isFetching}
            onCheckedChange={(hidden) =>
              save.mutate({ userId, source: setting.source, hidden })
            }
          />
        </div>
      ))}
      {save.isSuccess && !settings.isFetching && (
        <p role="status" className="text-sm text-muted-foreground">
          Account preferences saved.
        </p>
      )}
    </section>
  );
}
