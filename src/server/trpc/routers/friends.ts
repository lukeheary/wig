import { withPublicProfiles } from "@/server/utils/profile-visibility";
import { withVisibleProfiles } from "@/server/utils/profile-visibility";
import { visibleEventIdCondition } from "@/server/utils/event-source-visibility";
import { z } from "zod";
import { router, protectedProcedure } from "../init";
import {
  eventActivity,
  eventRsvps,
  users,
  userFriends,
  userFriendsMutedNotifications,
  userActivity,
  userBlocks,
  userPartners,
} from "../../db/schema";
import { eq, and, or, ne, sql, inArray, desc, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  createNotification,
  deleteNotificationsForEntity,
} from "@/server/utils/notifications";
import { sendPushNotificationToUsers } from "@/server/utils/push-notifications";
import { accentInsensitiveLike } from "@/server/db/search";
import { blockedUserIdsFor, usersAreBlocked } from "@/server/utils/user-blocks";

export const friendsRouter = router({
  listBlockedUsers: protectedProcedure.query(async ({ ctx }) => {
    const blocks = await ctx.db.query.userBlocks.findMany({
      where: await withVisibleProfiles(eq(userBlocks.blockerUserId, ctx.auth.userId), userBlocks.blockerUserId, userBlocks.blockedUserId),
      with: { blocked: true },
      orderBy: [desc(userBlocks.createdAt)],
    });

    return blocks.map((block) => block.blocked);
  }),

  removeFriend: protectedProcedure
    .input(z.object({ friendUserId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const friendship = await ctx.db.query.userFriends.findFirst({
        where: and(
          eq(userFriends.status, "accepted"),
          or(
            and(
              eq(userFriends.userId, ctx.auth.userId),
              eq(userFriends.friendUserId, input.friendUserId)
            ),
            and(
              eq(userFriends.userId, input.friendUserId),
              eq(userFriends.friendUserId, ctx.auth.userId)
            )
          )
        ),
      });

      if (!friendship) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Friendship not found",
        });
      }

      await ctx.db.delete(userFriends).where(eq(userFriends.id, friendship.id));

      await ctx.db
        .delete(userFriendsMutedNotifications)
        .where(
          or(
            and(
              eq(userFriendsMutedNotifications.userId, ctx.auth.userId),
              eq(userFriendsMutedNotifications.friendUserId, input.friendUserId)
            ),
            and(
              eq(userFriendsMutedNotifications.userId, input.friendUserId),
              eq(userFriendsMutedNotifications.friendUserId, ctx.auth.userId)
            )
          )
        );

      return { success: true };
    }),

  searchUsers: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1),
        limit: z.number().min(1).max(50).default(10),
        includeAll: z.boolean().default(false), // If true, includes friends in results
      })
    )
    .query(async ({ ctx, input }) => {
      // Get existing friend connections (accepted or pending) in both directions
      const existingFriendships = await ctx.db.query.userFriends.findMany({
        where: await withVisibleProfiles(or(
          eq(userFriends.userId, ctx.auth.userId),
          eq(userFriends.friendUserId, ctx.auth.userId)
        ), userFriends.userId, userFriends.friendUserId),
      });
      const blockedUserIds = [...(await blockedUserIdsFor(ctx.auth.userId))];

      // Always exclude self, optionally exclude existing friendships
      const excludedUserIds = input.includeAll
        ? [ctx.auth.userId]
        : [
            ctx.auth.userId,
            ...existingFriendships.map((f) =>
              f.userId === ctx.auth.userId ? f.friendUserId : f.userId
            ),
          ];

      // Search by username, email, firstName, or lastName (case insensitive)
      const results = await ctx.db.query.users.findMany({
        where: await withVisibleProfiles(and(
          or(
            accentInsensitiveLike(users.username, input.query),
            accentInsensitiveLike(users.email, input.query),
            accentInsensitiveLike(users.firstName, input.query, {
              coalesceToEmpty: true,
            }),
            accentInsensitiveLike(users.lastName, input.query, {
              coalesceToEmpty: true,
            })
          ),
          eq(users.isOnboarding, false),
          ...(blockedUserIds.length > 0
            ? [notInArray(users.id, blockedUserIds)]
            : []),
          sql`${users.id} NOT IN (${sql.join(
            excludedUserIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        ), users.id),
        limit: input.limit,
      });

      return results;
    }),

  sendFriendRequest: protectedProcedure
    .input(z.object({ friendUserId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify the friend user exists
      const friendUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.friendUserId),
      });

      if (!friendUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Prevent sending request to self
      if (input.friendUserId === ctx.auth.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot send friend request to yourself",
        });
      }

      if (await usersAreBlocked(ctx.auth.userId, input.friendUserId)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Check for existing friendship in BOTH directions
      const existingFriendship = await ctx.db.query.userFriends.findFirst({
        where: or(
          and(
            eq(userFriends.userId, ctx.auth.userId),
            eq(userFriends.friendUserId, input.friendUserId)
          ),
          and(
            eq(userFriends.userId, input.friendUserId),
            eq(userFriends.friendUserId, ctx.auth.userId)
          )
        ),
      });

      if (existingFriendship) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            existingFriendship.status === "accepted"
              ? "You are already friends"
              : "Friend request already exists",
        });
      }

      const [friendRequest] = await ctx.db
        .insert(userFriends)
        .values({
          userId: ctx.auth.userId,
          friendUserId: input.friendUserId,
          status: "pending",
        })
        .returning();

      const currentUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
        columns: {
          firstName: true,
          lastName: true,
          username: true,
        },
      });

      const senderName =
        [currentUser?.firstName, currentUser?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        currentUser?.username ||
        "Someone";

      await createNotification(
        {
          userId: input.friendUserId,
          actorUserId: ctx.auth.userId,
          type: "friend_request",
          entityType: "friend_request",
          entityId: friendRequest.id,
          title: senderName,
          body: "Sent you a friend request",
          metadata: {
            requestId: friendRequest.id,
            requestType: "friend",
          },
        },
        ctx.db
      );

      await sendPushNotificationToUsers(
        [input.friendUserId],
        {
          title: senderName,
          body: "Sent you a friend request",
          data: {
            type: "friend_request",
            entityId: friendRequest.id,
            actionUrl: "/activity?view=requests",
          },
        },
        ctx.db
      );

      return friendRequest;
    }),

  acceptFriendRequest: protectedProcedure
    .input(z.object({ friendRequestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const friendRequest = await ctx.db.query.userFriends.findFirst({
        where: eq(userFriends.id, input.friendRequestId),
      });

      if (!friendRequest) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Friend request not found",
        });
      }

      // Verify current user is the recipient
      if (friendRequest.friendUserId !== ctx.auth.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only accept requests sent to you",
        });
      }

      if (await usersAreBlocked(ctx.auth.userId, friendRequest.userId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Friend request not found" });
      }

      if (friendRequest.status === "accepted") {
        return friendRequest;
      }

      const [updatedFriendship] = await ctx.db
        .update(userFriends)
        .set({
          status: "accepted",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userFriends.id, input.friendRequestId),
            eq(userFriends.status, "pending")
          )
        )
        .returning();

      if (!updatedFriendship) {
        const currentFriendship = await ctx.db.query.userFriends.findFirst({
          where: eq(userFriends.id, input.friendRequestId),
        });

        if (currentFriendship?.status === "accepted") {
          return currentFriendship;
        }

        throw new TRPCError({
          code: "CONFLICT",
          message: "This friend request changed before it could be accepted",
        });
      }

      try {
        await deleteNotificationsForEntity(
          {
            userId: ctx.auth.userId,
            entityType: "friend_request",
            entityIds: [input.friendRequestId],
          },
          ctx.db
        );

        const currentUser = await ctx.db.query.users.findFirst({
          where: eq(users.id, ctx.auth.userId),
          columns: {
            firstName: true,
            lastName: true,
            username: true,
          },
        });

        const accepterName =
          [currentUser?.firstName, currentUser?.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          currentUser?.username ||
          "Someone";

        await createNotification(
          {
            userId: friendRequest.userId,
            actorUserId: ctx.auth.userId,
            type: "friend_request_accepted",
            entityType: "friend_request",
            entityId: input.friendRequestId,
            title: accepterName,
            body: "Added you as a friend",
            actionUrl: "/activity?view=list",
            metadata: {
              requestId: input.friendRequestId,
              requestType: "friend",
            },
          },
          ctx.db
        );

        await sendPushNotificationToUsers(
          [friendRequest.userId],
          {
            title: accepterName,
            body: "Added you as a friend",
            data: {
              type: "friend_request_accepted",
              entityId: input.friendRequestId,
              actionUrl: "/activity?view=list",
            },
          },
          ctx.db
        );
      } catch (error) {
        console.error(
          "Friend request accepted, but notification delivery failed",
          {
            friendRequestId: input.friendRequestId,
            error,
          }
        );
      }

      return updatedFriendship;
    }),

  rejectFriendRequest: protectedProcedure
    .input(z.object({ friendRequestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const friendRequest = await ctx.db.query.userFriends.findFirst({
        where: eq(userFriends.id, input.friendRequestId),
      });

      if (!friendRequest) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Friend request not found",
        });
      }

      // Verify current user is the recipient or sender
      if (
        friendRequest.friendUserId !== ctx.auth.userId &&
        friendRequest.userId !== ctx.auth.userId
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot reject this request",
        });
      }

      const otherUserId =
        friendRequest.userId === ctx.auth.userId
          ? friendRequest.friendUserId
          : friendRequest.userId;

      await ctx.db
        .delete(userFriends)
        .where(eq(userFriends.id, input.friendRequestId));

      await ctx.db
        .delete(userFriendsMutedNotifications)
        .where(
          or(
            and(
              eq(userFriendsMutedNotifications.userId, ctx.auth.userId),
              eq(userFriendsMutedNotifications.friendUserId, otherUserId)
            ),
            and(
              eq(userFriendsMutedNotifications.userId, otherUserId),
              eq(userFriendsMutedNotifications.friendUserId, ctx.auth.userId)
            )
          )
        );

      await deleteNotificationsForEntity(
        {
          entityType: "friend_request",
          entityIds: [input.friendRequestId],
        },
        ctx.db
      );

      return { success: true };
    }),

  listFriends: protectedProcedure
    .input(
      z.object({
        statusFilter: z.enum(["pending", "accepted"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        or(
          eq(userFriends.userId, ctx.auth.userId),
          eq(userFriends.friendUserId, ctx.auth.userId)
        ),
      ];

      if (input.statusFilter) {
        conditions.push(eq(userFriends.status, input.statusFilter));
      }

      const friendships = await ctx.db.query.userFriends.findMany({
        where: await withVisibleProfiles(and(...conditions), userFriends.userId, userFriends.friendUserId),
        orderBy: [userFriends.createdAt],
      });

      // Fetch user details for each friendship
      const friendsWithDetails = await Promise.all(
        friendships.map(async (friendship) => {
          const friendId =
            friendship.userId === ctx.auth.userId
              ? friendship.friendUserId
              : friendship.userId;

          const friendUser = await ctx.db.query.users.findFirst({
            where: eq(users.id, friendId),
          });

          return {
            ...friendship,
            friend: friendUser,
            isSender: friendship.userId === ctx.auth.userId,
          };
        })
      );

      return friendsWithDetails;
    }),

  getFriendStatus: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const friendship = await ctx.db.query.userFriends.findFirst({
        where: or(
          and(
            eq(userFriends.userId, ctx.auth.userId),
            eq(userFriends.friendUserId, input.userId)
          ),
          and(
            eq(userFriends.userId, input.userId),
            eq(userFriends.friendUserId, ctx.auth.userId)
          )
        ),
      });

      if (!friendship) {
        return { status: "none" as const };
      }

      if (friendship.status === "accepted") {
        return { status: "accepted" as const };
      }

      // Pending - determine if sent or received
      if (friendship.userId === ctx.auth.userId) {
        return { status: "pending_sent" as const };
      } else {
        return { status: "pending_received" as const };
      }
    }),

  getPendingRequests: protectedProcedure.query(async ({ ctx }) => {
    // Get pending friend requests sent TO the current user
    const pendingRequests = await ctx.db.query.userFriends.findMany({
      where: await withVisibleProfiles(and(
        eq(userFriends.friendUserId, ctx.auth.userId),
        eq(userFriends.status, "pending")
      ), userFriends.userId, userFriends.friendUserId),
      orderBy: [userFriends.createdAt],
      with: {
        user: true, // The user who sent the request
      },
    });

    return pendingRequests;
  }),

  getRecentUsers: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        cursor: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get existing friend connections (accepted or pending) in both directions
      const existingFriendships = await ctx.db.query.userFriends.findMany({
        where: await withVisibleProfiles(or(
          eq(userFriends.userId, ctx.auth.userId),
          eq(userFriends.friendUserId, ctx.auth.userId)
        ), userFriends.userId, userFriends.friendUserId),
      });

      const excludedUserIds = [
        ctx.auth.userId, // Exclude self
        ...existingFriendships.map((f) =>
          f.userId === ctx.auth.userId ? f.friendUserId : f.userId
        ),
      ];

      // Get recent users, excluding self and existing friends
      const recentUsers = await ctx.db.query.users.findMany({
        where: await withVisibleProfiles(and(
          eq(users.isOnboarding, false),
          sql`${users.id} NOT IN (${sql.join(
            excludedUserIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        ), users.id),
        orderBy: [desc(users.createdAt)],
        limit: input.limit + 1, // Fetch one extra to check if there are more
        offset: input.cursor,
      });

      const hasMore = recentUsers.length > input.limit;
      const items = hasMore ? recentUsers.slice(0, -1) : recentUsers;

      return {
        items,
        nextCursor: hasMore ? input.cursor + input.limit : null,
      };
    }),

  getFriendFeed: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        includeEventUpdates: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      const feedWindow = Math.min(250, input.limit + input.offset + 50);

      // 1. Get all accepted friends
      const userFriendships = await ctx.db.query.userFriends.findMany({
        where: await withVisibleProfiles(and(
          or(
            eq(userFriends.userId, ctx.auth.userId),
            eq(userFriends.friendUserId, ctx.auth.userId)
          ),
          eq(userFriends.status, "accepted")
        ), userFriends.userId, userFriends.friendUserId),
      });

      const friendIds = userFriendships.map((f) =>
        f.userId === ctx.auth.userId ? f.friendUserId : f.userId
      );
      const currentPartnerRelationship =
        await ctx.db.query.userPartners.findFirst({
          where: withPublicProfiles(and(
            eq(userPartners.status, "accepted"),
            or(
              eq(userPartners.requesterId, ctx.auth.userId),
              eq(userPartners.recipientId, ctx.auth.userId)
            )
          ), userPartners.requesterId, userPartners.recipientId),
        });
      const currentPartnerUserId = currentPartnerRelationship
        ? currentPartnerRelationship.requesterId === ctx.auth.userId
          ? currentPartnerRelationship.recipientId
          : currentPartnerRelationship.requesterId
        : null;

      // 2. Fetch activity for these friends
      const activities =
        friendIds.length > 0
          ? await ctx.db.query.userActivity.findMany({
              where: await withVisibleProfiles(and(inArray(userActivity.actorUserId, friendIds), or(ne(userActivity.entityType, "event"), visibleEventIdCondition(userActivity.entityId))), userActivity.actorUserId),
              orderBy: [
                desc(userActivity.updatedAt),
                desc(userActivity.createdAt),
              ],
              limit: feedWindow,
              with: {
                actor: true,
                event: {
                  with: {
                    venue: true,
                  },
                },
                place: true,
              },
            })
          : [];

      const visibleActivities = activities.filter((activity) => {
        if (activity.type === "follow_place") return false;
        if (activity.type === "created_event") return false;
        if (activity.entityType !== "event") return true;
        if (!activity.event) return false;

        const includePartner =
          ((activity.metadata as { includePartner?: boolean } | null)
            ?.includePartner ?? false) === true;
        const isPartnerMirroredRsvp =
          (activity.type === "rsvp_going" ||
            activity.type === "rsvp_interested") &&
          includePartner;

        if (
          isPartnerMirroredRsvp &&
          activity.actorUserId === currentPartnerUserId
        ) {
          return false;
        }

        return true;
      });

      const actorIdsWithPartnerIncluded = [
        ...new Set(
          visibleActivities
            .filter(
              (activity) =>
                (activity.type === "rsvp_going" ||
                  activity.type === "rsvp_interested" ||
                  activity.type === "rsvp_not_going") &&
                (activity.metadata as { includePartner?: boolean } | null)
                  ?.includePartner === true
            )
            .map((activity) => activity.actorUserId)
        ),
      ];

      let friendFeed = visibleActivities;

      if (actorIdsWithPartnerIncluded.length > 0) {
        const actorIdSet = new Set(actorIdsWithPartnerIncluded);
        const friendIdSet = new Set(friendIds);
        const partnerRelationships = await ctx.db.query.userPartners.findMany({
          where: await withVisibleProfiles(and(
            eq(userPartners.status, "accepted"),
            or(
              inArray(userPartners.requesterId, actorIdsWithPartnerIncluded),
              inArray(userPartners.recipientId, actorIdsWithPartnerIncluded)
            )
          ), userPartners.requesterId, userPartners.recipientId),
          with: {
            requester: true,
            recipient: true,
          },
        });

        const partnerFirstNameByActorId = new Map<string, string>();
        for (const relationship of partnerRelationships) {
          if (
            actorIdSet.has(relationship.requesterId) &&
            relationship.recipient &&
            friendIdSet.has(relationship.recipientId)
          ) {
            partnerFirstNameByActorId.set(
              relationship.requesterId,
              relationship.recipient.firstName || "their partner"
            );
          }

          if (
            actorIdSet.has(relationship.recipientId) &&
            relationship.requester &&
            friendIdSet.has(relationship.requesterId)
          ) {
            partnerFirstNameByActorId.set(
              relationship.recipientId,
              relationship.requester.firstName || "their partner"
            );
          }
        }

        friendFeed = visibleActivities.map((activity) => {
          const includePartner =
            (activity.metadata as { includePartner?: boolean } | null)
              ?.includePartner === true;
          const isPartnerEligibleType =
            activity.type === "rsvp_going" ||
            activity.type === "rsvp_interested" ||
            activity.type === "rsvp_not_going";
          const partnerFirstName = partnerFirstNameByActorId.get(
            activity.actorUserId
          );

          if (!includePartner || !isPartnerEligibleType || !partnerFirstName) {
            return activity;
          }

          return {
            ...activity,
            partnerFirstName,
          };
        });
      }

      // 3. Add event updates for events the current user is following via RSVP
      const normalizedEventUpdates = input.includeEventUpdates
        ? await (async () => {
            const subscribedRsvps = await ctx.db.query.eventRsvps.findMany({
              where: await withVisibleProfiles(and(
                eq(eventRsvps.userId, ctx.auth.userId),
                inArray(eventRsvps.status, ["going", "interested"])
              ), eventRsvps.userId),
              columns: {
                eventId: true,
              },
            });

            const subscribedEventIds = [
              ...new Set(subscribedRsvps.map((rsvp) => rsvp.eventId)),
            ];

            if (subscribedEventIds.length === 0) {
              return [];
            }

            const eventUpdates = await ctx.db.query.eventActivity.findMany({
              where: await withVisibleProfiles(and(inArray(eventActivity.eventId, subscribedEventIds), visibleEventIdCondition(eventActivity.eventId)), eventActivity.actorUserId),
              orderBy: [desc(eventActivity.createdAt)],
              limit: feedWindow,
              with: {
                actor: true,
                event: {
                  with: {
                    venue: true,
                  },
                },
              },
            });

            return eventUpdates
              .filter(
                (update) => Boolean(update.event) && update.type !== "created"
              )
              .map((update) => ({
                ...update,
                entityType: "event" as const,
                entityId: update.eventId,
              }));
          })()
        : [];

      const getActivityTimestamp = (
        activity:
          | (typeof friendFeed)[number]
          | (typeof normalizedEventUpdates)[number]
      ) => ("updatedAt" in activity ? activity.updatedAt : activity.createdAt);

      return [...friendFeed, ...normalizedEventUpdates]
        .sort(
          (a, b) =>
            new Date(getActivityTimestamp(b) as Date | string).getTime() -
            new Date(getActivityTimestamp(a) as Date | string).getTime()
        )
        .slice(input.offset, input.offset + input.limit);
    }),
});
