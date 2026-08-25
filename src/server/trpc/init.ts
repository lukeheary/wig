import { initTRPC, TRPCError } from "@trpc/server";
import { type Context } from "./context";
import superjson from "superjson";
import { db } from "../db";
import { users, placeMembers } from "../db/schema";
import { eq, and } from "drizzle-orm";
import {
  ACCOUNT_RESTRICTED_MESSAGE,
  assertUserCanCreateContent,
  isAccountRestrictedError,
} from "@/server/utils/user-moderation";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

// Protected procedure - requires authentication
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({
    ctx: {
      ...ctx,
      auth: { ...ctx.auth, userId: ctx.auth.userId }, // Type narrowing
    },
  });
});

// Use for mutations that publish or edit user-generated content. Reads,
// support requests, account deletion, and appeals intentionally remain usable.
export const contentMutationProcedure = protectedProcedure.use(
  async ({ ctx, next }) => {
    try {
      await assertUserCanCreateContent(ctx.auth.userId);
    } catch (error) {
      if (!isAccountRestrictedError(error)) throw error;
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ACCOUNT_RESTRICTED_MESSAGE,
      });
    }

    return next({ ctx });
  }
);

// Admin procedure - requires authentication and admin role
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const user = await db.query.users.findFirst({
    where: eq(users.id, ctx.auth.userId),
  });

  if (!user || user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      user,
    },
  });
});

// Place member procedure - requires authentication and place membership
export const placeMemberProcedure = protectedProcedure.use(
  async ({ ctx, next, input }) => {
    const placeId = (input as any)?.placeId;

    if (!placeId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "placeId is required",
      });
    }

    const membership = await db.query.placeMembers.findFirst({
      where: and(
        eq(placeMembers.userId, ctx.auth.userId),
        eq(placeMembers.placeId, placeId)
      ),
    });

    if (!membership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of this place",
      });
    }

    return next({
      ctx: {
        ...ctx,
        placeMembership: membership,
      },
    });
  }
);
