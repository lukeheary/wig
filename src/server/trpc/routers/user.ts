import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../init";
import { users, placeMembers, userSurfaceState } from "@/server/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { addDays } from "date-fns";
import { USER_SURFACE_VALUES } from "@/lib/user-surface-state";

const RESERVED_USERNAMES = new Set(["luke"]);

export const userRouter = router({
  isAdmin: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.auth.userId),
    });

    return {
      isAdmin: user?.role === "admin",
    };
  }),

  hasVenues: protectedProcedure.query(async ({ ctx }) => {
    // Get places where user is a member and type is venue
    const memberships = await ctx.db.query.placeMembers.findMany({
      where: eq(placeMembers.userId, ctx.auth.userId),
      with: {
        place: true,
      },
      limit: 10,
    });

    return memberships.some((m) => m.place.type === "venue");
  }),

  hasOrganizers: protectedProcedure.query(async ({ ctx }) => {
    // Get places where user is a member and type is organizer
    const memberships = await ctx.db.query.placeMembers.findMany({
      where: eq(placeMembers.userId, ctx.auth.userId),
      with: {
        place: true,
      },
      limit: 10,
    });

    return memberships.some((m) => m.place.type === "organizer");
  }),

  hasPlaces: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.query.placeMembers.findMany({
      where: eq(placeMembers.userId, ctx.auth.userId),
      limit: 1,
    });

    return memberships.length > 0;
  }),

  updateUsername: protectedProcedure
    .input(
      z.object({
        username: z
          .string()
          .min(3, "Username must be at least 3 characters")
          .max(20, "Username must be at most 20 characters")
          .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
        city: z.string().optional(),
        state: z.string().optional(),
        gender: z.enum(["male", "female", "other"]).optional(),
        dateOfBirth: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD")
          .optional(),
        avatarImageUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.auth.userId;
      const normalizedUsername = input.username.toLowerCase();

      if (RESERVED_USERNAMES.has(normalizedUsername)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Username is already taken",
        });
      }

      // Check if username is already taken by another user
      const existingUser = await ctx.db.query.users.findFirst({
        where: and(
          eq(users.username, normalizedUsername),
          ne(users.id, userId)
        ),
      });

      if (existingUser) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Username is already taken",
        });
      }

      // Ensure a DB row exists for this Clerk user before onboarding updates.
      const userRecord = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!userRecord) {
        const clerk = await clerkClient();
        const clerkUser = await clerk.users.getUser(userId);
        const primaryEmail =
          clerkUser.emailAddresses.find(
            (email) => email.id === clerkUser.primaryEmailAddressId
          )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;

        if (!primaryEmail) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to resolve user email from Clerk",
          });
        }

        const normalizedEmail = primaryEmail.toLowerCase().trim();
        const existingUserByEmail = await ctx.db.query.users.findFirst({
          where: eq(users.email, normalizedEmail),
        });

        if (existingUserByEmail && existingUserByEmail.id !== userId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An account with this email already exists",
          });
        }

        await ctx.db
          .insert(users)
          .values({
            id: userId,
            email: normalizedEmail,
            username: normalizedUsername,
            firstName: clerkUser.firstName,
            lastName: clerkUser.lastName,
            avatarImageUrl: input.avatarImageUrl ?? null,
            city: input.city,
            state: input.state,
            gender: input.gender,
            dateOfBirth: input.dateOfBirth,
            isOnboarding: false,
          })
          .onConflictDoNothing();
      }

      // Build update object
      const updateData: Record<string, any> = {
        username: normalizedUsername,
        updatedAt: new Date(),
        isOnboarding: false, // Mark onboarding as complete
      };

      if (input.city) {
        updateData.city = input.city;
      }
      if (input.state) {
        updateData.state = input.state;
      }
      if (input.gender) {
        updateData.gender = input.gender;
      }
      if (input.dateOfBirth) {
        updateData.dateOfBirth = input.dateOfBirth;
      }
      if (input.avatarImageUrl) {
        updateData.avatarImageUrl = input.avatarImageUrl;
      }

      // Update the user's username and location
      const [updatedUser] = await ctx.db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();

      if (!updatedUser) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update username",
        });
      }

      // Update Clerk's public metadata to mark onboarding as complete
      // This allows middleware to check onboarding status
      const clerk = await clerkClient();
      await clerk.users.updateUserMetadata(userId, {
        publicMetadata: {
          isOnboarding: false,
        },
      });

      return updatedUser;
    }),

  getCurrentUser: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.auth.userId;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    return user;
  }),

  getSurfaceState: protectedProcedure
    .input(
      z.object({
        surface: z.enum(USER_SURFACE_VALUES),
      })
    )
    .query(async ({ ctx, input }) => {
      const surfaceState = await ctx.db.query.userSurfaceState.findFirst({
        where: and(
          eq(userSurfaceState.userId, ctx.auth.userId),
          eq(userSurfaceState.surface, input.surface)
        ),
      });

      return surfaceState ?? null;
    }),

  markSurfaceVisited: protectedProcedure
    .input(
      z.object({
        surface: z.enum(USER_SURFACE_VALUES),
        startMissedWindowAt: z.date().nullable().optional(),
        windowDays: z.number().int().min(1).max(14).default(2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const existingState = await ctx.db.query.userSurfaceState.findFirst({
        where: and(
          eq(userSurfaceState.userId, ctx.auth.userId),
          eq(userSurfaceState.surface, input.surface)
        ),
      });

      const activeMissedWindowExpiresAt =
        existingState?.missedWindowExpiresAt?.getTime() ?? null;
      const hasActiveMissedWindow =
        existingState?.missedWindowStartAt != null &&
        activeMissedWindowExpiresAt != null &&
        activeMissedWindowExpiresAt > now.getTime();

      const nextMissedWindowStartAt = hasActiveMissedWindow
        ? existingState?.missedWindowStartAt ?? null
        : input.startMissedWindowAt ?? null;
      const nextMissedWindowExpiresAt = hasActiveMissedWindow
        ? existingState?.missedWindowExpiresAt ?? null
        : input.startMissedWindowAt
          ? addDays(now, input.windowDays)
          : null;

      const [surfaceState] = await ctx.db
        .insert(userSurfaceState)
        .values({
          userId: ctx.auth.userId,
          surface: input.surface,
          lastVisitedAt: now,
          missedWindowStartAt: nextMissedWindowStartAt,
          missedWindowExpiresAt: nextMissedWindowExpiresAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userSurfaceState.userId, userSurfaceState.surface],
          set: {
            lastVisitedAt: now,
            missedWindowStartAt: nextMissedWindowStartAt,
            missedWindowExpiresAt: nextMissedWindowExpiresAt,
            updatedAt: now,
          },
        })
        .returning();

      return surfaceState;
    }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        username: z
          .string()
          .min(3, "Username must be at least 3 characters")
          .max(20, "Username must be at most 20 characters")
          .regex(
            /^[a-zA-Z0-9_]+$/,
            "Username can only contain letters, numbers, and underscores"
          )
          .optional(),
        firstName: z.string().min(1).max(100).optional(),
        lastName: z.string().min(1).max(100).optional(),
        avatarImageUrl: z.string().url().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        gender: z.enum(["male", "female", "other"]).optional(),
        dateOfBirth: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD")
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.auth.userId;
      const normalizedUsername = input.username?.toLowerCase().trim();

      if (normalizedUsername !== undefined) {
        if (RESERVED_USERNAMES.has(normalizedUsername)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Username is already taken",
          });
        }

        const existingUser = await ctx.db.query.users.findFirst({
          where: and(eq(users.username, normalizedUsername), ne(users.id, userId)),
        });

        if (existingUser) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Username is already taken",
          });
        }
      }

      // Build update object with only provided fields
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      };

      if (normalizedUsername !== undefined) {
        updateData.username = normalizedUsername;
      }
      if (input.firstName !== undefined) {
        updateData.firstName = input.firstName;
      }
      if (input.lastName !== undefined) {
        updateData.lastName = input.lastName;
      }
      if (input.avatarImageUrl !== undefined) {
        updateData.avatarImageUrl = input.avatarImageUrl;
      }
      if (input.city !== undefined) {
        updateData.city = input.city;
      }
      if (input.state !== undefined) {
        updateData.state = input.state;
      }
      if (input.gender !== undefined) {
        updateData.gender = input.gender;
      }
      if (input.dateOfBirth !== undefined) {
        updateData.dateOfBirth = input.dateOfBirth;
      }

      // Update in our database
      const [updatedUser] = await ctx.db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();

      if (!updatedUser) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update profile",
        });
      }

      // Sync with Clerk (firstName and lastName only, not avatarImageUrl as we use S3)
      try {
        const client = await clerkClient();
        const clerkUpdateData: Record<string, any> = {};

        if (input.firstName !== undefined) {
          clerkUpdateData.firstName = input.firstName;
        }
        if (input.lastName !== undefined) {
          clerkUpdateData.lastName = input.lastName;
        }

        // Update Clerk user metadata (excluding avatarImageUrl)
        if (Object.keys(clerkUpdateData).length > 0) {
          await client.users.updateUser(userId, clerkUpdateData);
        }
      } catch (error) {
        console.error("Error syncing with Clerk:", error);
        // Don't throw - we've already updated our DB
      }

      return updatedUser;
    }),

  updateEmail: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.auth.userId;

      const [updatedUser] = await ctx.db
        .update(users)
        .set({
          email: input.email,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      if (!updatedUser) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update email",
        });
      }

      return updatedUser;
    }),
});
