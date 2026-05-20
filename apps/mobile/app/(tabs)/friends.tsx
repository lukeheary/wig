import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { Screen } from "../../components/screen";
import {
  Button,
  Card,
  FieldLabel,
  Heading,
  Input,
  Pill,
} from "../../components/ui";
import { mobileTheme } from "../../lib/theme";
import { trpc } from "../../lib/trpc";
import { UserRow } from "../../components/user-row";
import type { FriendConnection, FriendUser } from "../../types/api";

type FriendsTab = "discover" | "requests" | "friends";

export default function FriendsScreen() {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<FriendsTab>("discover");
  const [query, setQuery] = useState("");

  if (!isSignedIn) {
    return (
      <Screen>
        <Heading subtitle="Sign in to see friend activity.">Friends</Heading>
        <Card>
          <Text style={styles.cardTitle}>Friend activity needs an account</Text>
          <Text style={styles.bodyText}>
            Once you sign in, this tab can use the existing friends backend.
          </Text>
          <Button onPress={() => router.push("/(auth)")}>Sign in</Button>
        </Card>
      </Screen>
    );
  }

  const friendsQuery = trpc.friends.listFriends.useQuery({});
  const pendingQuery = trpc.friends.listFriends.useQuery({
    statusFilter: "pending",
  });
  const recentUsersQuery = trpc.friends.getRecentUsers.useQuery(
    { limit: 20, cursor: 0 },
    { enabled: tab === "discover" && query.trim().length < 2 }
  );
  const searchResultsQuery = trpc.friends.searchUsers.useQuery(
    {
      query: query.trim(),
      limit: 20,
      includeAll: true,
    },
    { enabled: tab === "discover" && query.trim().length >= 2 }
  );

  const sendRequestMutation = trpc.friends.sendFriendRequest.useMutation({
    onSuccess: () => {
      utils.friends.listFriends.invalidate();
      utils.friends.getRecentUsers.invalidate();
      utils.friends.searchUsers.invalidate();
    },
  });
  const acceptMutation = trpc.friends.acceptFriendRequest.useMutation({
    onSuccess: () => {
      utils.friends.listFriends.invalidate();
    },
  });
  const rejectMutation = trpc.friends.rejectFriendRequest.useMutation({
    onSuccess: () => {
      utils.friends.listFriends.invalidate();
    },
  });

  const allConnections = (friendsQuery.data ?? []) as FriendConnection[];
  const pendingConnections = (pendingQuery.data ?? []) as FriendConnection[];
  const acceptedFriends = useMemo(
    () => allConnections.filter((friendship) => friendship.status === "accepted"),
    [allConnections]
  );
  const receivedRequests = useMemo(
    () => pendingConnections.filter((friendship) => !friendship.isSender),
    [pendingConnections]
  );
  const sentRequests = useMemo(
    () => pendingConnections.filter((friendship) => friendship.isSender),
    [pendingConnections]
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredFriends = acceptedFriends.filter((friendship) => {
    const user = friendship.friend;
    if (!user) return false;
    if (!normalizedQuery) return true;
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").toLowerCase();
    return (
      fullName.includes(normalizedQuery) ||
      (user.username ?? "").toLowerCase().includes(normalizedQuery) ||
      (user.email ?? "").toLowerCase().includes(normalizedQuery)
    );
  });
  const discoverUsers: FriendUser[] =
    query.trim().length >= 2
      ? ((searchResultsQuery.data ?? []) as FriendUser[])
      : ((recentUsersQuery.data?.items ?? []) as FriendUser[]);

  function getRelationshipLabel(userId: string) {
    const match = allConnections.find((friendship) => friendship.friend?.id === userId);
    if (!match) return null;
    if (match.status === "accepted") return "Friend";
    return match.isSender ? "Request sent" : "Respond";
  }

  async function safeMutation(action: () => Promise<void>, title: string) {
    try {
      await action();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      Alert.alert(title, message);
    }
  }

  return (
    <Screen>
      <Heading subtitle="Find people, manage requests, and keep your WIG circle in sync.">
        Friends
      </Heading>

      <Card>
        <View style={styles.pillRow}>
          <Pill active={tab === "discover"} onPress={() => setTab("discover")}>
            Discover
          </Pill>
          <Pill active={tab === "requests"} onPress={() => setTab("requests")}>
            Requests
          </Pill>
          <Pill active={tab === "friends"} onPress={() => setTab("friends")}>
            Friends
          </Pill>
        </View>

        <View>
          <FieldLabel>
            {tab === "discover"
              ? "Search people"
              : tab === "requests"
                ? "Search requests"
                : "Search your friends"}
          </FieldLabel>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={
              tab === "discover"
                ? "Search by name, username, or email"
                : tab === "requests"
                  ? "Search pending requests"
                  : "Search your friends"
            }
          />
        </View>
      </Card>

      {tab === "discover" ? (
        <>
          {discoverUsers.map((user: FriendUser) => {
            const relationshipLabel = getRelationshipLabel(user.id);

            return (
              <UserRow
                key={user.id}
                user={user}
                subtitle={
                  relationshipLabel
                    ? relationshipLabel
                    : "Add them to see who is going out."
                }
                actionLabel={
                  relationshipLabel
                    ? relationshipLabel === "Respond"
                      ? "Requests"
                      : "Added"
                    : "Add friend"
                }
                actionVariant={relationshipLabel ? "ghost" : "primary"}
                actionDisabled={Boolean(relationshipLabel)}
                onPressAction={
                  relationshipLabel
                    ? relationshipLabel === "Respond"
                      ? () => setTab("requests")
                      : undefined
                    : () =>
                        safeMutation(
                          async () => {
                            await sendRequestMutation.mutateAsync({
                              friendUserId: user.id,
                            });
                          },
                          "Could not send request"
                        )
                }
              />
            );
          })}

          {!searchResultsQuery.isLoading &&
          !recentUsersQuery.isLoading &&
          (query.trim().length >= 2
            ? (searchResultsQuery.data?.length ?? 0) === 0
            : (recentUsersQuery.data?.items?.length ?? 0) === 0) ? (
            <Card>
              <Text style={styles.cardTitle}>No people found</Text>
              <Text style={styles.bodyText}>
                Try another search or come back after more people join WIG.
              </Text>
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === "requests" ? (
        <>
          {receivedRequests.map((request) =>
            request.friend ? (
              <UserRow
                key={request.id}
                user={request.friend}
                subtitle="Sent you a friend request"
                actionLabel="Accept"
                secondaryActionLabel="Decline"
                onPressAction={() =>
                  safeMutation(
                    async () => {
                      await acceptMutation.mutateAsync({
                        friendRequestId: request.id,
                      });
                    },
                    "Could not accept request"
                  )
                }
                onPressSecondaryAction={() =>
                  safeMutation(
                    async () => {
                      await rejectMutation.mutateAsync({
                        friendRequestId: request.id,
                      });
                    },
                    "Could not decline request"
                  )
                }
              />
            ) : null
          )}

          {sentRequests.map((request) =>
            request.friend ? (
              <UserRow
                key={request.id}
                user={request.friend}
                subtitle="Pending request"
                actionLabel="Cancel"
                actionVariant="ghost"
                onPressAction={() =>
                  safeMutation(
                    async () => {
                      await rejectMutation.mutateAsync({
                        friendRequestId: request.id,
                      });
                    },
                    "Could not cancel request"
                  )
                }
              />
            ) : null
          )}

          {!receivedRequests.length && !sentRequests.length ? (
            <Card>
              <Text style={styles.cardTitle}>No pending requests</Text>
              <Text style={styles.bodyText}>
                New friend requests will show up here.
              </Text>
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === "friends" ? (
        <>
          {filteredFriends.map((friendship) =>
            friendship.friend ? (
              <UserRow
                key={friendship.id}
                user={friendship.friend}
                subtitle="You’re connected on WIG"
              />
            ) : null
          )}

          {!filteredFriends.length ? (
            <Card>
              <Text style={styles.cardTitle}>No friends yet</Text>
              <Text style={styles.bodyText}>
                Add people from Discover to start seeing shared plans and RSVPs.
              </Text>
              <Button variant="secondary" onPress={() => setTab("discover")}>
                Find people
              </Button>
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bodyText: {
    color: mobileTheme.colors.mutedForeground,
    fontFamily: mobileTheme.fonts.bodyRegular,
    lineHeight: 22,
  },
  cardTitle: {
    color: mobileTheme.colors.foreground,
    fontFamily: mobileTheme.fonts.displayBold,
    fontSize: 22,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
