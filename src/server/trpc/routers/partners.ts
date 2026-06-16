import { TRPCError } from "@trpc/server";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { userFriends, userPartners, users } from "../../db/schema";
import { protectedProcedure, router } from "../init";
import {
  createNotification,
  deleteNotificationsForEntity,
} from "@/server/utils/notifications";
import { sendPushNotificationToUsers } from "@/server/utils/push-notifications";

export const partnersRouter = router({
  sendPartnerRequest: protectedProcedure
    .input(z.object({ recipientId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.recipientId === ctx.auth.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot send a partner request to yourself",
        });
      }

      const recipientUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.recipientId),
      });

      if (!recipientUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const friendship = await ctx.db.query.userFriends.findFirst({
        where: and(
          or(
            and(
              eq(userFriends.userId, ctx.auth.userId),
              eq(userFriends.friendUserId, input.recipientId)
            ),
            and(
              eq(userFriends.userId, input.recipientId),
              eq(userFriends.friendUserId, ctx.auth.userId)
            )
          ),
          eq(userFriends.status, "accepted")
        ),
      });

      if (!friendship) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can only send partner requests to accepted friends",
        });
      }

      const existingRelationships = await ctx.db.query.userPartners.findMany({
        where: or(
          eq(userPartners.requesterId, ctx.auth.userId),
          eq(userPartners.recipientId, ctx.auth.userId),
          eq(userPartners.requesterId, input.recipientId),
          eq(userPartners.recipientId, input.recipientId)
        ),
      });

      const existingBetweenUsers = existingRelationships.find(
        (relationship) =>
          (relationship.requesterId === ctx.auth.userId &&
            relationship.recipientId === input.recipientId) ||
          (relationship.requesterId === input.recipientId &&
            relationship.recipientId === ctx.auth.userId)
      );

      if (existingBetweenUsers) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            existingBetweenUsers.status === "accepted"
              ? "You are already partners"
              : existingBetweenUsers.requesterId === ctx.auth.userId
                ? "Partner request already sent"
                : "This user already sent you a partner request",
        });
      }

      const currentUserHasPartner = existingRelationships.some(
        (relationship) =>
          relationship.requesterId === ctx.auth.userId ||
          relationship.recipientId === ctx.auth.userId
      );
      if (currentUserHasPartner) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have a partner relationship",
        });
      }

      const recipientHasPartner = existingRelationships.some(
        (relationship) =>
          relationship.requesterId === input.recipientId ||
          relationship.recipientId === input.recipientId
      );
      if (recipientHasPartner) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This user already has a partner relationship",
        });
      }

      const [partnerRequest] = await ctx.db
        .insert(userPartners)
        .values({
          requesterId: ctx.auth.userId,
          recipientId: input.recipientId,
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
          userId: input.recipientId,
          actorUserId: ctx.auth.userId,
          type: "partner_request",
          entityType: "partner_request",
          entityId: partnerRequest.id,
          title: "Partner Request",
          body: `${senderName} sent you a partner request`,
          metadata: {
            requestId: partnerRequest.id,
            requestType: "partner",
          },
        },
        ctx.db
      );

      await sendPushNotificationToUsers(
        [input.recipientId],
        {
          title: "Partner Request",
          body: `${senderName} sent you a partner request`,
          data: {
            type: "partner_request",
            entityId: partnerRequest.id,
            actionUrl: "/profile",
          },
        },
        ctx.db
      );

      return partnerRequest;
    }),

  acceptPartnerRequest: protectedProcedure
    .input(z.object({ partnerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const partnerRequest = await ctx.db.query.userPartners.findFirst({
        where: eq(userPartners.id, input.partnerId),
      });

      if (!partnerRequest) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Partner request not found",
        });
      }

      if (partnerRequest.recipientId !== ctx.auth.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only accept partner requests sent to you",
        });
      }

      if (partnerRequest.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This partner request has already been processed",
        });
      }

      const [updatedRelationship] = await ctx.db
        .update(userPartners)
        .set({
          status: "accepted",
          updatedAt: new Date(),
        })
        .where(eq(userPartners.id, input.partnerId))
        .returning();

      await deleteNotificationsForEntity(
        {
          userId: ctx.auth.userId,
          entityType: "partner_request",
          entityIds: [input.partnerId],
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
          userId: partnerRequest.requesterId,
          actorUserId: ctx.auth.userId,
          type: "partner_request_accepted",
          entityType: "partner_request",
          entityId: input.partnerId,
          title: "Partner Request Accepted",
          body: `${accepterName} is now your partner`,
          actionUrl: "/profile",
          metadata: {
            requestId: input.partnerId,
            requestType: "partner",
          },
        },
        ctx.db
      );

      await sendPushNotificationToUsers(
        [partnerRequest.requesterId],
        {
          title: "Partner Request Accepted",
          body: `${accepterName} is now your partner`,
          data: {
            type: "partner_request_accepted",
            entityId: input.partnerId,
            actionUrl: "/profile",
          },
        },
        ctx.db
      );

      return updatedRelationship;
    }),

  declinePartnerRequest: protectedProcedure
    .input(z.object({ partnerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const partnerRequest = await ctx.db.query.userPartners.findFirst({
        where: eq(userPartners.id, input.partnerId),
      });

      if (!partnerRequest) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Partner request not found",
        });
      }

      if (
        partnerRequest.requesterId !== ctx.auth.userId &&
        partnerRequest.recipientId !== ctx.auth.userId
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot decline this partner request",
        });
      }

      await ctx.db.delete(userPartners).where(eq(userPartners.id, input.partnerId));

      await deleteNotificationsForEntity(
        {
          entityType: "partner_request",
          entityIds: [input.partnerId],
        },
        ctx.db
      );

      return { success: true };
    }),

  removePartner: protectedProcedure.mutation(async ({ ctx }) => {
    const existingRelationship = await ctx.db.query.userPartners.findFirst({
      where: and(
        or(
          eq(userPartners.requesterId, ctx.auth.userId),
          eq(userPartners.recipientId, ctx.auth.userId)
        ),
        eq(userPartners.status, "accepted")
      ),
    });

    if (!existingRelationship) {
      return { success: false };
    }

    await ctx.db
      .delete(userPartners)
      .where(eq(userPartners.id, existingRelationship.id));

    return { success: true };
  }),

  getMyPartner: protectedProcedure.query(async ({ ctx }) => {
    const relationship = await ctx.db.query.userPartners.findFirst({
      where: or(
        eq(userPartners.requesterId, ctx.auth.userId),
        eq(userPartners.recipientId, ctx.auth.userId)
      ),
      with: {
        requester: true,
        recipient: true,
      },
    });

    if (!relationship) {
      return null;
    }

    const partnerUser =
      relationship.requesterId === ctx.auth.userId
        ? relationship.recipient
        : relationship.requester;

    return {
      id: relationship.id,
      status: relationship.status,
      createdAt: relationship.createdAt,
      updatedAt: relationship.updatedAt,
      isRequester: relationship.requesterId === ctx.auth.userId,
      partner: partnerUser,
    };
  }),

  getPartnerStatus: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const relationship = await ctx.db.query.userPartners.findFirst({
        where: or(
          and(
            eq(userPartners.requesterId, ctx.auth.userId),
            eq(userPartners.recipientId, input.userId)
          ),
          and(
            eq(userPartners.requesterId, input.userId),
            eq(userPartners.recipientId, ctx.auth.userId)
          )
        ),
      });

      if (!relationship) {
        return { status: "none" as const };
      }

      if (relationship.status === "accepted") {
        return { status: "accepted" as const };
      }

      if (relationship.requesterId === ctx.auth.userId) {
        return { status: "pending_sent" as const };
      }

      return { status: "pending_received" as const };
    }),

  getPendingPartnerRequests: protectedProcedure.query(async ({ ctx }) => {
    const pendingRequests = await ctx.db.query.userPartners.findMany({
      where: and(
        eq(userPartners.recipientId, ctx.auth.userId),
        eq(userPartners.status, "pending")
      ),
      orderBy: [desc(userPartners.createdAt)],
      with: {
        requester: true,
      },
    });

    return pendingRequests.map((request) => ({
      ...request,
      partner: request.requester,
    }));
  }),
});
