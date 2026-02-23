import { z } from "zod";
import { router, protectedProcedure } from "../init";
import {
  eventActivity,
  eventRsvps,
  users,
  userFriends,
  userActivity,
  userPartners,
} from "../../db/schema";
import { eq, and, or, ne, sql, inArray, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const friendsRouter = router({
  searchUsers: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1),
        limit: z.number().min(1).max(50).default(10),
        includeAll: z.boolean().default(false), // If true, includes friends in results
      })
    )
    .query(async ({ ctx, input }) => {
      const searchPattern = `%${input.query}%`;

      // Get existing friend connections (accepted or pending) in both directions
      const existingFriendships = await ctx.db.query.userFriends.findMany({
        where: or(
          eq(userFriends.userId, ctx.auth.userId),
          eq(userFriends.friendUserId, ctx.auth.userId)
        ),
      });

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
        where: and(
          or(
            sql`LOWER(${users.username}) LIKE LOWER(${searchPattern})`,
            sql`LOWER(${users.email}) LIKE LOWER(${searchPattern})`,
            sql`LOWER(${users.firstName}) LIKE LOWER(${searchPattern})`,
            sql`LOWER(${users.lastName}) LIKE LOWER(${searchPattern})`
          ),
          sql`${users.id} NOT IN (${sql.join(
            excludedUserIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        ),
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

      // Verify status is pending
      if (friendRequest.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This request has already been processed",
        });
      }

      const [updatedFriendship] = await ctx.db
        .update(userFriends)
        .set({
          status: "accepted",
          updatedAt: new Date(),
        })
        .where(eq(userFriends.id, input.friendRequestId))
        .returning();

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

      await ctx.db.delete(userFriends).where(eq(userFriends.id, input.friendRequestId));

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
        where: and(...conditions),
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
      where: and(
        eq(userFriends.friendUserId, ctx.auth.userId),
        eq(userFriends.status, "pending")
      ),
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
        where: or(
          eq(userFriends.userId, ctx.auth.userId),
          eq(userFriends.friendUserId, ctx.auth.userId)
        ),
      });

      const excludedUserIds = [
        ctx.auth.userId, // Exclude self
        ...existingFriendships.map((f) =>
          f.userId === ctx.auth.userId ? f.friendUserId : f.userId
        ),
      ];

      // Get recent users, excluding self and existing friends
      const recentUsers = await ctx.db.query.users.findMany({
        where: sql`${users.id} NOT IN (${sql.join(
          excludedUserIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
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
      })
    )
    .query(async ({ ctx, input }) => {
      const feedWindow = Math.min(250, input.limit + input.offset + 50);

      // 1. Get all accepted friends
      const userFriendships = await ctx.db.query.userFriends.findMany({
        where: and(
          or(
            eq(userFriends.userId, ctx.auth.userId),
            eq(userFriends.friendUserId, ctx.auth.userId)
          ),
          eq(userFriends.status, "accepted")
        ),
      });

      const friendIds = userFriendships.map((f) =>
        f.userId === ctx.auth.userId ? f.friendUserId : f.userId
      );

      // 2. Fetch activity for these friends
      const activities =
        friendIds.length > 0
          ? await ctx.db.query.userActivity.findMany({
              where: inArray(userActivity.actorUserId, friendIds),
              orderBy: [desc(userActivity.createdAt)],
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
        if (activity.entityType !== "event") return true;
        return Boolean(activity.event);
      });

      const actorIdsWithPartnerIncluded = [
        ...new Set(
          visibleActivities
            .filter(
              (activity) =>
                (activity.type === "rsvp_going" ||
                  activity.type === "rsvp_interested" ||
                  activity.type === "rsvp_not_going") &&
                ((activity.metadata as { includePartner?: boolean } | null)
                  ?.includePartner === true)
            )
            .map((activity) => activity.actorUserId)
        ),
      ];

      let friendFeed = visibleActivities;

      if (actorIdsWithPartnerIncluded.length > 0) {
        const actorIdSet = new Set(actorIdsWithPartnerIncluded);
        const partnerRelationships = await ctx.db.query.userPartners.findMany({
          where: and(
            eq(userPartners.status, "accepted"),
            or(
              inArray(userPartners.requesterId, actorIdsWithPartnerIncluded),
              inArray(userPartners.recipientId, actorIdsWithPartnerIncluded)
            )
          ),
          with: {
            requester: true,
            recipient: true,
          },
        });

        const partnerFirstNameByActorId = new Map<string, string>();
        for (const relationship of partnerRelationships) {
          if (actorIdSet.has(relationship.requesterId) && relationship.recipient) {
            partnerFirstNameByActorId.set(
              relationship.requesterId,
              relationship.recipient.firstName || "their partner"
            );
          }

          if (actorIdSet.has(relationship.recipientId) && relationship.requester) {
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
      const subscribedRsvps = await ctx.db.query.eventRsvps.findMany({
        where: and(
          eq(eventRsvps.userId, ctx.auth.userId),
          inArray(eventRsvps.status, ["going", "interested"])
        ),
        columns: {
          eventId: true,
        },
      });

      const subscribedEventIds = [
        ...new Set(subscribedRsvps.map((rsvp) => rsvp.eventId)),
      ];

      const eventUpdates =
        subscribedEventIds.length > 0
          ? await ctx.db.query.eventActivity.findMany({
              where: inArray(eventActivity.eventId, subscribedEventIds),
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
            })
          : [];

      const normalizedEventUpdates = eventUpdates
        .filter((update) => Boolean(update.event))
        .map((update) => ({
          ...update,
          entityType: "event" as const,
          entityId: update.eventId,
        }));

      return [...friendFeed, ...normalizedEventUpdates]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(input.offset, input.offset + input.limit);
    }),
});
