import { promoUrlSchema } from "@/server/utils/promo-validation";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  contentMutationProcedure,
  router,
  protectedProcedure,
  publicProcedure,
} from "../init";
import {
  eventRsvps,
  events,
  placeFollows,
  placeMembers,
  userPromotedEvents,
  userFriends,
  users,
  userSurfaceState,
  metroAreas,
} from "@/server/db/schema";
import { eq, and, ne, or, inArray, asc, gte, lt } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { addDays, addWeeks, startOfWeek } from "date-fns";
import { USER_SURFACE_VALUES } from "@/lib/user-surface-state";
import { isReservedUsername } from "@/lib/reserved-usernames";
import { mapEventCategoryData } from "@/server/utils/categories";
import { withStoredImageReplacements } from "@/server/utils/stored-image-lifecycle";
import { isAtLeastMinimumAge } from "@/lib/age-requirement";
import { assertTRPCTextContentAllowed } from "@/server/utils/content-moderation";

const minimumAgeDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD")
  .refine(isAtLeastMinimumAge, "You must be at least 13 years old to use WIG");

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

  getPromotionOptions: protectedProcedure
    .input(z.object({ weekOffset: z.number().int().min(0).max(52).default(0) }))
    .query(async ({ ctx, input }) => {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(
        start.getUTCDate() -
          ((start.getUTCDay() + 6) % 7) +
          input.weekOffset * 7
      );
      const end = new Date(start);
      end.setUTCDate(start.getUTCDate() + 7);
      const memberships = await ctx.db.query.placeMembers.findMany({
        where: and(
          eq(placeMembers.userId, ctx.auth.userId),
          eq(placeMembers.role, "promoter")
        ),
        columns: { placeId: true },
      });
      const placeIds = memberships.map((membership) => membership.placeId);
      if (placeIds.length === 0) return { events: [], hasMore: false };

      const [eligibleEvents, selections] = await Promise.all([
        ctx.db.query.events.findMany({
          where: and(
            or(
              inArray(events.venueId, placeIds),
              inArray(events.organizerId, placeIds)
            ),
            gte(events.startAt, start),
            lt(events.startAt, end),
            eq(events.visibility, "public"),
            eq(events.status, "active")
          ),
          with: { venue: true, organizer: true },
          orderBy: [asc(events.startAt)],
        }),
        ctx.db.query.userPromotedEvents.findMany({
          where: eq(userPromotedEvents.userId, ctx.auth.userId),
          columns: { eventId: true, promo: true, promoUrl: true },
        }),
      ]);
      const selectedIds = new Set(
        selections.map((selection) => selection.eventId)
      );

      const laterEvent = await ctx.db.query.events.findFirst({
        where: and(
          or(
            inArray(events.venueId, placeIds),
            inArray(events.organizerId, placeIds)
          ),
          gte(events.startAt, end),
          eq(events.visibility, "public"),
          eq(events.status, "active")
        ),
        columns: { id: true },
      });
      return {
        hasMore: Boolean(laterEvent),
        events: eligibleEvents.map((event) => ({
          id: event.id,
          title: event.title,
          startAt: event.startAt,
          coverImageUrl: event.coverImageUrl,
          placeName: event.venue?.name ?? event.organizer?.name ?? null,
          isPromoted: selectedIds.has(event.id),
          promoUrl:
            selections.find((selection) => selection.eventId === event.id)
              ?.promoUrl ?? null,
          promo:
            selections.find((selection) => selection.eventId === event.id)
              ?.promo ?? null,
        })),
      };
    }),

  setEventPromoted: contentMutationProcedure
    .input(
      z.object({
        eventId: z.string().uuid(),
        promoted: z.boolean(),
        promo: z.string().trim().max(70).nullable().optional(),
        promoUrl: promoUrlSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.promoted && input.promo) {
        assertTRPCTextContentAllowed([
          { field: "promo", value: input.promo, rejectProfanity: true },
        ]);
      }
      if (!input.promoted) {
        await ctx.db
          .delete(userPromotedEvents)
          .where(
            and(
              eq(userPromotedEvents.userId, ctx.auth.userId),
              eq(userPromotedEvents.eventId, input.eventId)
            )
          );
        return { promoted: false };
      }

      const event = await ctx.db.query.events.findFirst({
        where: and(
          eq(events.id, input.eventId),
          eq(events.visibility, "public"),
          eq(events.status, "active"),
          gte(events.startAt, new Date())
        ),
        columns: { venueId: true, organizerId: true },
      });
      const placeIds = [event?.venueId, event?.organizerId].filter(
        (placeId): placeId is string => Boolean(placeId)
      );
      if (placeIds.length === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This event is not eligible for promotion.",
        });
      }
      const membership = await ctx.db.query.placeMembers.findFirst({
        where: and(
          eq(placeMembers.userId, ctx.auth.userId),
          eq(placeMembers.role, "promoter"),
          inArray(placeMembers.placeId, placeIds)
        ),
        columns: { id: true },
      });
      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "You can only promote events for places where you are a promoter.",
        });
      }

      await ctx.db
        .insert(userPromotedEvents)
        .values({
          userId: ctx.auth.userId,
          eventId: input.eventId,
          promo: input.promo || null,
          promoUrl: input.promoUrl ?? null,
        })
        .onConflictDoUpdate({
          target: [userPromotedEvents.userId, userPromotedEvents.eventId],
          set: {
            promo: input.promo || null,
            ...(input.promoUrl !== undefined
              ? { promoUrl: input.promoUrl }
              : {}),
          },
        });
      return { promoted: true };
    }),

  updateUsername: contentMutationProcedure
    .input(
      z.object({
        username: z
          .string()
          .min(3, "Username must be at least 3 characters")
          .max(20, "Username must be at most 20 characters")
          .regex(
            /^[a-zA-Z0-9_]+$/,
            "Username can only contain letters, numbers, and underscores"
          ),
        city: z.string().optional(),
        state: z.string().optional(),
        gender: z.enum(["male", "female", "other"]).optional(),
        dateOfBirth: minimumAgeDateSchema.optional(),
        avatarImageUrl: z.string().optional(),
        metroAreaId: z.string().uuid("Please choose an available location"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.auth.userId;
      const normalizedUsername = input.username.toLowerCase();

      const selectedMetroArea = await ctx.db.query.metroAreas.findFirst({
        where: and(
          eq(metroAreas.id, input.metroAreaId),
          eq(metroAreas.isEnabled, true)
        ),
      });
      if (!selectedMetroArea) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Please choose an available location",
        });
      }

      assertTRPCTextContentAllowed([
        { field: "username", value: normalizedUsername },
      ]);

      if (isReservedUsername(normalizedUsername)) {
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
            metroAreaId: selectedMetroArea.id,
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
        metroAreaId: selectedMetroArea.id,
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

  getProfileByUsername: publicProcedure
    .input(
      z.object({
        username: z.string().min(1).max(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const normalizedUsername = input.username.toLowerCase().trim();
      const targetUser = await ctx.db.query.users.findFirst({
        where: eq(users.username, normalizedUsername),
      });

      if (!targetUser || isReservedUsername(normalizedUsername)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Profile not found",
        });
      }

      const now = new Date();
      const viewerUserId = ctx.auth.userId ?? null;

      const [
        friendships,
        pendingRequests,
        viewerTargetFriendship,
        profileRsvps,
        followedPlaces,
        targetPlaceMemberships,
      ] = await Promise.all([
        ctx.db.query.userFriends.findMany({
          where: and(
            or(
              eq(userFriends.userId, targetUser.id),
              eq(userFriends.friendUserId, targetUser.id)
            ),
            eq(userFriends.status, "accepted")
          ),
          with: {
            user: true,
            friend: true,
          },
        }),
        ctx.db.query.userFriends.findMany({
          where: and(
            eq(userFriends.friendUserId, targetUser.id),
            eq(userFriends.status, "pending")
          ),
        }),
        viewerUserId
          ? ctx.db.query.userFriends.findFirst({
              where: or(
                and(
                  eq(userFriends.userId, viewerUserId),
                  eq(userFriends.friendUserId, targetUser.id)
                ),
                and(
                  eq(userFriends.userId, targetUser.id),
                  eq(userFriends.friendUserId, viewerUserId)
                )
              ),
            })
          : Promise.resolve(null),
        ctx.db.query.eventRsvps.findMany({
          where: and(
            eq(eventRsvps.userId, targetUser.id),
            inArray(eventRsvps.status, ["going", "interested"])
          ),
          with: {
            event: {
              with: {
                venue: true,
                organizer: true,
                categoryLinks: {
                  with: {
                    category: true,
                  },
                },
              },
            },
          },
          orderBy: [asc(eventRsvps.updatedAt)],
        }),
        ctx.db.query.placeFollows.findMany({
          where: eq(placeFollows.userId, targetUser.id),
          columns: { id: true },
        }),
        ctx.db.query.placeMembers.findMany({
          where: and(
            eq(placeMembers.userId, targetUser.id),
            eq(placeMembers.role, "promoter")
          ),
          columns: { placeId: true },
        }),
      ]);

      const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
      const nextWeekStart = addWeeks(currentWeekStart, 1);
      const promoterPlaceIds = targetPlaceMemberships.map(
        (membership) => membership.placeId
      );
      const promotingEvents =
        promoterPlaceIds.length > 0
          ? await ctx.db.query.userPromotedEvents
              .findMany({
                where: eq(userPromotedEvents.userId, targetUser.id),
                with: {
                  event: {
                    with: {
                      venue: true,
                      organizer: true,
                      categoryLinks: {
                        with: { category: true },
                      },
                    },
                  },
                },
              })
              .then((selections) =>
                selections
                  .filter(
                    ({ event }) =>
                      event.startAt >= now &&
                      event.startAt < nextWeekStart &&
                      event.visibility === "public" &&
                      event.status === "active" &&
                      ((event.venueId !== null &&
                        promoterPlaceIds.includes(event.venueId)) ||
                        (event.organizerId !== null &&
                          promoterPlaceIds.includes(event.organizerId)))
                  )
                  .sort(
                    (a, b) =>
                      a.event.startAt.getTime() - b.event.startAt.getTime()
                  )
              )
          : [];

      const friendSummaries = friendships.flatMap((friendship) => {
        const friend =
          friendship.userId === targetUser.id
            ? friendship.friend
            : friendship.user;

        if (!friend) return [];

        return [
          {
            id: friend.id,
            firstName: friend.firstName,
            lastName: friend.lastName,
            username: friend.username,
            avatarImageUrl: friend.avatarImageUrl,
            city: friend.city,
            state: friend.state,
          },
        ];
      });

      const upcomingRsvps = profileRsvps
        .filter((rsvp) => rsvp.event && rsvp.event.startAt >= now)
        .sort((a, b) => a.event!.startAt.getTime() - b.event!.startAt.getTime())
        .slice(0, 12);
      const pastRsvps = profileRsvps
        .filter((rsvp) => rsvp.event && rsvp.event.startAt < now)
        .sort((a, b) => b.event!.startAt.getTime() - a.event!.startAt.getTime())
        .slice(0, 12);

      const mapProfileEvent = (rsvp: (typeof profileRsvps)[number]) => {
        if (!rsvp.event) return null;
        const event = mapEventCategoryData(rsvp.event);
        const socialRsvp = {
          id: rsvp.id,
          userId: targetUser.id,
          eventId: event.id,
          status: rsvp.status,
          notGoingReason: rsvp.notGoingReason,
          partnerRsvpByUserId: rsvp.partnerRsvpByUserId,
          createdAt: rsvp.createdAt,
          updatedAt: rsvp.updatedAt,
          user: {
            id: targetUser.id,
            firstName: targetUser.firstName,
            lastName: targetUser.lastName,
            avatarImageUrl: targetUser.avatarImageUrl,
          },
        };

        return {
          ...event,
          userRsvp: viewerUserId === targetUser.id ? rsvp : null,
          friendsGoing: rsvp.status === "going" ? [socialRsvp] : [],
          friendsInterested: rsvp.status === "interested" ? [socialRsvp] : [],
        };
      };

      const mapPromotingEvent = (
        promotingEvent: (typeof promotingEvents)[number]
      ) => ({
        ...mapEventCategoryData(promotingEvent.event),
        promo: promotingEvent.promo,
        promoUrl: promotingEvent.promoUrl,
        userRsvp: null,
        friendsGoing: [],
        friendsInterested: [],
      });

      return {
        profile: {
          id: targetUser.id,
          firstName: targetUser.firstName,
          lastName: targetUser.lastName,
          username: targetUser.username,
          avatarImageUrl: targetUser.avatarImageUrl,
          city: targetUser.city,
          state: targetUser.state,
          isCurrentUser: viewerUserId === targetUser.id,
          friendStatus: viewerTargetFriendship
            ? viewerTargetFriendship.status === "accepted"
              ? "accepted"
              : viewerTargetFriendship.userId === viewerUserId
                ? "pending_sent"
                : "pending_received"
            : "none",
        },
        friendCount: friendSummaries.length,
        followingCount: followedPlaces.length,
        isPromoter: targetPlaceMemberships.length > 0,
        requestCount:
          viewerUserId === targetUser.id ? pendingRequests.length : 0,
        friends: friendSummaries,
        promotingEvents: promotingEvents.map(mapPromotingEvent),
        upcomingEvents: upcomingRsvps.map(mapProfileEvent).filter(Boolean),
        pastEvents: pastRsvps.map(mapProfileEvent).filter(Boolean),
      };
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
        windowDays: z.number().int().min(1).max(14).default(1),
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
        ? (existingState?.missedWindowStartAt ?? null)
        : (input.startMissedWindowAt ?? null);
      const nextMissedWindowExpiresAt = hasActiveMissedWindow
        ? (existingState?.missedWindowExpiresAt ?? null)
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

  updateProfile: contentMutationProcedure
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
        dateOfBirth: minimumAgeDateSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.auth.userId;
      const normalizedUsername = input.username?.toLowerCase().trim();
      assertTRPCTextContentAllowed([
        { field: "username", value: normalizedUsername },
        { field: "firstName", value: input.firstName },
        { field: "lastName", value: input.lastName },
      ]);
      const existingProfile = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { avatarImageUrl: true },
      });

      if (normalizedUsername !== undefined) {
        if (isReservedUsername(normalizedUsername)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Username is already taken",
          });
        }

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
      const [updatedUser] = await withStoredImageReplacements({
        db: ctx.db,
        replacements: [
          {
            oldUrl: existingProfile?.avatarImageUrl,
            newUrl:
              input.avatarImageUrl === undefined
                ? existingProfile?.avatarImageUrl
                : input.avatarImageUrl,
          },
        ],
        persist: () =>
          ctx.db
            .update(users)
            .set(updateData)
            .where(eq(users.id, userId))
            .returning(),
      });

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
