import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../init";
import {
  cities,
  eventRsvps,
  events,
  metroAreas,
  userFriends,
  users,
  placeFollows,
  placeMembers,
  places,
} from "../../db/schema";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { logActivity } from "../../utils/activity-logger";
import {
  mapEventCategoryData,
  mapPlaceCategoryData,
  setPlaceCategoryKeys,
} from "@/server/utils/categories";
import {
  INSTAGRAM_HANDLE_ERROR,
  INSTAGRAM_HANDLE_REGEX,
  PLACE_SLUG_ERROR,
  PLACE_SLUG_REGEX,
} from "@/lib/place-identifiers";
import { accentInsensitiveLike } from "@/server/db/search";
import { withStoredImageReplacements } from "@/server/utils/stored-image-lifecycle";

const placeTypeSchema = z.enum(["venue", "organizer"]);

export const placeRouter = router({
  searchPlaces: publicProcedure
    .input(
      z.object({
        query: z.string().optional(),
        type: placeTypeSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(places.isEnabled, true)];
      if (input.query) {
        conditions.push(accentInsensitiveLike(places.name, input.query));
      }
      if (input.type) {
        conditions.push(eq(places.type, input.type));
      }

      const results = await ctx.db.query.places.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        limit: 10,
        orderBy: [asc(places.name)],
        with: {
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      return results.map(mapPlaceCategoryData);
    }),

  suggestEventTitles: protectedProcedure
    .input(
      z.object({
        venueId: z.string().uuid(),
        query: z.string().trim().optional().default(""),
        limit: z.number().min(1).max(20).default(8),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
      });
      const isAdmin = user?.role === "admin";

      if (!isAdmin) {
        const isMember = await ctx.db.query.placeMembers.findFirst({
          where: and(
            eq(placeMembers.userId, ctx.auth.userId),
            eq(placeMembers.placeId, input.venueId)
          ),
        });

        if (!isMember) {
          return [];
        }
      }

      const titleQuery = input.query.trim();
      const titleCondition = titleQuery
        ? accentInsensitiveLike(events.title, titleQuery)
        : undefined;

      const eventRows = await ctx.db.query.events.findMany({
        where: titleCondition
          ? and(eq(events.venueId, input.venueId), titleCondition)
          : eq(events.venueId, input.venueId),
        columns: {
          title: true,
          startAt: true,
          endAt: true,
          createdAt: true,
        },
        orderBy: [desc(events.createdAt), desc(events.startAt)],
        limit: 100,
      });

      const seen = new Set<string>();
      const suggestions: Array<{
        title: string;
        startAt: Date;
        endAt: Date | null;
      }> = [];

      for (const row of eventRows) {
        const normalized = row.title.trim().toLowerCase();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        suggestions.push({
          title: row.title.trim(),
          startAt: row.startAt,
          endAt: row.endAt,
        });
        if (suggestions.length >= input.limit) break;
      }

      return suggestions;
    }),

  createPlace: protectedProcedure
    .input(
      z.object({
        type: placeTypeSchema,
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        logoImageUrl: z.string().url().optional().or(z.literal("")),
        address: z.string().optional(),
        city: z.string().max(100).optional(),
        state: z.string().length(2).optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        website: z.string().url().optional().or(z.literal("")),
        instagram: z
          .string()
          .max(100)
          .refine(
            (value) => value === "" || INSTAGRAM_HANDLE_REGEX.test(value),
            INSTAGRAM_HANDLE_ERROR
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Generate initial slug
      let slug = input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      if (slug.length < 3) slug = `${input.type}-${slug}`;

      // Check for collision
      const existing = await ctx.db.query.places.findFirst({
        where: eq(places.slug, slug),
      });

      if (existing) {
        slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
      }

      const [place] = await ctx.db
        .insert(places)
        .values({
          ...input,
          slug,
        })
        .returning();

      if (
        input.city &&
        input.state &&
        input.latitude != null &&
        input.longitude != null
      ) {
        await ctx.db
          .insert(cities)
          .values({
            name: input.city,
            state: input.state,
            latitude: input.latitude,
            longitude: input.longitude,
          })
          .onConflictDoNothing();
      }

      const created = await ctx.db.query.places.findFirst({
        where: eq(places.id, place.id),
        with: {
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      return created ? mapPlaceCategoryData(created) : place;
    }),

  listPlaces: publicProcedure
    .input(
      z.object({
        type: placeTypeSchema.optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        search: z.string().optional(),
        followedOnly: z.boolean().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(places.isEnabled, true)];

      if (input.type) conditions.push(eq(places.type, input.type));
      if (input.city) {
        // Look up metro area for coordinates and radius
        const metro = await ctx.db.query.metroAreas.findFirst({
          where: eq(metroAreas.name, input.city),
        });

        let originCity: { latitude: number; longitude: number } | undefined;
        let radiusMiles = 20;

        if (metro?.latitude != null && metro?.longitude != null) {
          originCity = { latitude: metro.latitude, longitude: metro.longitude };
          radiusMiles = metro.radiusMiles ?? 20;
        } else {
          // Fall back to cities table
          const cityConditions = [eq(cities.name, input.city)];
          if (input.state) {
            cityConditions.push(eq(cities.state, input.state));
          }
          const cityRecord = await ctx.db.query.cities.findFirst({
            where: and(...cityConditions),
          });
          if (cityRecord?.latitude != null && cityRecord?.longitude != null) {
            originCity = {
              latitude: cityRecord.latitude,
              longitude: cityRecord.longitude,
            };
          }
        }

        if (originCity) {
          // Use Haversine formula to find nearby places
          const distanceSql = sql`
            (
              3959 * 2 * asin(
                sqrt(
                  pow(sin(radians(${originCity.latitude} - ${cities.latitude}) / 2), 2) +
                  cos(radians(${originCity.latitude})) * cos(radians(${cities.latitude})) *
                  pow(sin(radians(${originCity.longitude} - ${cities.longitude}) / 2), 2)
                )
              )
            )
          `;

          const nearbyPlaceIds = await ctx.db
            .select({ id: places.id })
            .from(places)
            .innerJoin(
              cities,
              and(eq(cities.name, places.city), eq(cities.state, places.state))
            )
            .where(sql`${distanceSql} <= ${radiusMiles}`);

          if (nearbyPlaceIds.length === 0) {
            return [];
          }

          conditions.push(
            inArray(
              places.id,
              nearbyPlaceIds.map((row) => row.id)
            )
          );
        } else {
          // Fallback to exact match if no coordinates found
          conditions.push(eq(places.city, input.city));
        }
      }
      if (input.state && !input.city)
        conditions.push(eq(places.state, input.state));
      if (input.search) {
        conditions.push(accentInsensitiveLike(places.name, input.search));
      }

      if (input.followedOnly) {
        if (!ctx.auth.userId) {
          return [];
        }

        const followedPlaceIds = await ctx.db
          .select({ placeId: placeFollows.placeId })
          .from(placeFollows)
          .where(eq(placeFollows.userId, ctx.auth.userId));

        if (followedPlaceIds.length === 0) {
          return [];
        }

        conditions.push(
          inArray(
            places.id,
            followedPlaceIds.map((f) => f.placeId)
          )
        );
      }

      const placesList = await ctx.db.query.places.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(places.createdAt)],
        with: {
          follows: true,
          members: true,
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      if (placesList.length === 0) return [];

      const placeIds = placesList.map((p) => p.id);
      const now = new Date();

      // Count upcoming events where this place is the venue
      const venueCounts = await ctx.db
        .select({
          placeId: events.venueId,
          count: sql<number>`count(*)::int`,
        })
        .from(events)
        .where(and(inArray(events.venueId, placeIds), gte(events.startAt, now)))
        .groupBy(events.venueId);

      // Count upcoming events where this place is the organizer
      const organizerCounts = await ctx.db
        .select({
          placeId: events.organizerId,
          count: sql<number>`count(*)::int`,
        })
        .from(events)
        .where(
          and(inArray(events.organizerId, placeIds), gte(events.startAt, now))
        )
        .groupBy(events.organizerId);

      const countMap = new Map<string, number>();
      for (const row of venueCounts) {
        if (row.placeId)
          countMap.set(
            row.placeId,
            (countMap.get(row.placeId) ?? 0) + row.count
          );
      }
      for (const row of organizerCounts) {
        if (row.placeId)
          countMap.set(
            row.placeId,
            (countMap.get(row.placeId) ?? 0) + row.count
          );
      }

      return placesList.map((p) => ({
        ...mapPlaceCategoryData(p),
        eventCount: countMap.get(p.id) ?? 0,
      }));
    }),

  getPlaceBySlug: publicProcedure
    .input(z.object({ slug: z.string(), type: placeTypeSchema.optional() }))
    .query(async ({ ctx, input }) => {
      const place = await ctx.db.query.places.findFirst({
        where: input.type
          ? and(eq(places.slug, input.slug), eq(places.type, input.type))
          : eq(places.slug, input.slug),
        with: {
          follows: true,
          members: {
            with: {
              user: true,
            },
          },
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      if (!place) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Place not found",
        });
      }

      const now = new Date();

      // Get events where this place is either the venue or the organizer
      const eventCondition =
        place.type === "venue"
          ? eq(events.venueId, place.id)
          : eq(events.organizerId, place.id);

      const upcomingEvents = await ctx.db.query.events.findMany({
        where: and(eventCondition, gte(events.startAt, now)),
        orderBy: [asc(events.startAt)],
        with: {
          venue: true,
          organizer: true,
          createdBy: true,
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      const pastEvents = await ctx.db.query.events.findMany({
        where: and(eventCondition, lt(events.startAt, now)),
        orderBy: [desc(events.startAt)],
        limit: 12,
        with: {
          venue: true,
          organizer: true,
          createdBy: true,
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      // Fetch friendsGoing and userRsvp for these events if user is authenticated
      const allEventIds = [...upcomingEvents, ...pastEvents].map((e) => e.id);
      const attendeesMap = new Map<string, any[]>();
      const userRsvpMap = new Map<string, any>();

      if (ctx.auth.userId && allEventIds.length > 0) {
        // Fetch current user and their RSVPs
        const [currentUser, userRsvps] = await Promise.all([
          ctx.db.query.users.findFirst({
            where: eq(users.id, ctx.auth.userId),
          }),
          ctx.db.query.eventRsvps.findMany({
            where: and(
              inArray(eventRsvps.eventId, allEventIds),
              eq(eventRsvps.userId, ctx.auth.userId)
            ),
          }),
        ]);

        for (const rsvp of userRsvps) {
          userRsvpMap.set(rsvp.eventId, rsvp);
        }

        const mirroredPartnerRsvps = await ctx.db.query.eventRsvps.findMany({
          where: and(
            inArray(eventRsvps.eventId, allEventIds),
            eq(eventRsvps.partnerRsvpByUserId, ctx.auth.userId),
            eq(eventRsvps.status, "going")
          ),
          with: {
            user: true,
          },
        });

        const addAttendee = (eventId: string, attendee: any) => {
          if (!attendeesMap.has(eventId)) {
            attendeesMap.set(eventId, []);
          }

          const attendees = attendeesMap.get(eventId)!;
          if (
            attendees.some((existing) => existing.userId === attendee.userId)
          ) {
            return;
          }

          attendees.push(attendee);
        };

        // Add current user to attendeesMap if they're going
        if (currentUser) {
          for (const userRsvp of userRsvps) {
            if (userRsvp.status === "going") {
              addAttendee(userRsvp.eventId, {
                ...userRsvp,
                user: currentUser,
              } as any);
            }
          }
        }

        for (const rsvp of mirroredPartnerRsvps) {
          addAttendee(rsvp.eventId, rsvp);
        }

        const friendConnections = await ctx.db.query.userFriends.findMany({
          where: and(
            or(
              eq(userFriends.userId, ctx.auth.userId),
              eq(userFriends.friendUserId, ctx.auth.userId)
            ),
            eq(userFriends.status, "accepted")
          ),
        });

        const friendIds = friendConnections.map((f) =>
          f.userId === ctx.auth.userId ? f.friendUserId : f.userId
        );

        if (friendIds.length > 0) {
          const friendsRsvps = await ctx.db.query.eventRsvps.findMany({
            where: and(
              inArray(eventRsvps.eventId, allEventIds),
              inArray(eventRsvps.userId, friendIds),
              eq(eventRsvps.status, "going")
            ),
            with: {
              user: true,
            },
          });

          for (const rsvp of friendsRsvps) {
            addAttendee(rsvp.eventId, rsvp);
          }
        }
      }

      return {
        ...mapPlaceCategoryData(place),
        events: upcomingEvents.map((e) => ({
          ...mapEventCategoryData(e),
          userRsvp: userRsvpMap.get(e.id) || null,
          friendsGoing: attendeesMap.get(e.id) || [],
          friendsInterested: [] as never[],
        })),
        pastEvents: pastEvents.map((e) => ({
          ...mapEventCategoryData(e),
          userRsvp: userRsvpMap.get(e.id) || null,
          friendsGoing: attendeesMap.get(e.id) || [],
          friendsInterested: [] as never[],
        })),
      };
    }),

  getPlaceById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const place = await ctx.db.query.places.findFirst({
        where: eq(places.id, input.id),
        with: {
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      if (!place) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Place not found",
        });
      }

      return mapPlaceCategoryData(place);
    }),

  followPlace: protectedProcedure
    .input(z.object({ placeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if already following
      const existing = await ctx.db.query.placeFollows.findFirst({
        where: and(
          eq(placeFollows.userId, ctx.auth.userId),
          eq(placeFollows.placeId, input.placeId)
        ),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You are already following this place",
        });
      }

      const [follow] = await ctx.db
        .insert(placeFollows)
        .values({
          userId: ctx.auth.userId,
          placeId: input.placeId,
        })
        .returning();

      if (follow) {
        void logActivity({
          actorUserId: ctx.auth.userId,
          type: "follow_place",
          entityType: "place",
          entityId: input.placeId,
          metadata: {},
        });
      }

      return follow;
    }),

  unfollowPlace: protectedProcedure
    .input(z.object({ placeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(placeFollows)
        .where(
          and(
            eq(placeFollows.userId, ctx.auth.userId),
            eq(placeFollows.placeId, input.placeId)
          )
        )
        .returning();

      if (result.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "You are not following this place",
        });
      }

      return { success: true };
    }),

  isFollowingPlace: protectedProcedure
    .input(z.object({ placeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const follow = await ctx.db.query.placeFollows.findFirst({
        where: and(
          eq(placeFollows.userId, ctx.auth.userId),
          eq(placeFollows.placeId, input.placeId)
        ),
      });

      return !!follow;
    }),

  listFollowedPlaces: protectedProcedure
    .input(z.object({ type: placeTypeSchema.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const followedPlaces = await ctx.db.query.placeFollows.findMany({
        where: eq(placeFollows.userId, ctx.auth.userId),
        with: {
          place: {
            with: {
              follows: true,
              members: true,
              categoryLinks: {
                with: {
                  category: true,
                },
              },
            },
          },
        },
        orderBy: [desc(placeFollows.createdAt)],
      });

      let result = followedPlaces.map((f) => mapPlaceCategoryData(f.place));

      if (input?.type) {
        result = result.filter((p) => p.type === input.type);
      }

      return result;
    }),

  getMyPlaces: protectedProcedure
    .input(z.object({ type: placeTypeSchema.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const myPlaces = await ctx.db.query.placeMembers.findMany({
        where: eq(placeMembers.userId, ctx.auth.userId),
        with: {
          place: {
            with: {
              follows: true,
              members: true,
              categoryLinks: {
                with: {
                  category: true,
                },
              },
            },
          },
        },
        orderBy: [desc(placeMembers.createdAt)],
      });

      let result = myPlaces.map((m) => mapPlaceCategoryData(m.place));

      if (input?.type) {
        result = result.filter((p) => p.type === input.type);
      }

      // Fetch upcoming events for each place
      const placeIds = result.map((p) => p.id);
      if (placeIds.length > 0) {
        const upcomingEventsMap = new Map<string, any[]>();

        // Get events where any of these places are venues
        const venueEvents = await ctx.db.query.events.findMany({
          where: and(
            inArray(events.venueId, placeIds),
            gte(events.startAt, new Date())
          ),
          orderBy: [asc(events.startAt)],
          limit: 50,
          with: {
            categoryLinks: {
              with: {
                category: true,
              },
            },
          },
        });

        // Get events where any of these places are organizers
        const organizerEvents = await ctx.db.query.events.findMany({
          where: and(
            inArray(events.organizerId, placeIds),
            gte(events.startAt, new Date())
          ),
          orderBy: [asc(events.startAt)],
          limit: 50,
          with: {
            categoryLinks: {
              with: {
                category: true,
              },
            },
          },
        });

        // Build map of place id to events
        for (const event of venueEvents) {
          if (event.venueId) {
            if (!upcomingEventsMap.has(event.venueId)) {
              upcomingEventsMap.set(event.venueId, []);
            }
            upcomingEventsMap
              .get(event.venueId)!
              .push(mapEventCategoryData(event));
          }
        }

        for (const event of organizerEvents) {
          if (event.organizerId) {
            if (!upcomingEventsMap.has(event.organizerId)) {
              upcomingEventsMap.set(event.organizerId, []);
            }
            upcomingEventsMap
              .get(event.organizerId)!
              .push(mapEventCategoryData(event));
          }
        }

        return result.map((place) => ({
          ...place,
          events: (upcomingEventsMap.get(place.id) || []).slice(0, 5),
        }));
      }

      return result.map((place) => ({
        ...place,
        events: [],
      }));
    }),

  updatePlace: protectedProcedure
    .input(
      z.object({
        placeId: z.string().uuid(),
        slug: z
          .string()
          .min(3)
          .max(100)
          .regex(PLACE_SLUG_REGEX, PLACE_SLUG_ERROR)
          .optional(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        logoImageUrl: z.string().url().optional().or(z.literal("")),
        coverImageUrl: z.string().url().optional().or(z.literal("")),
        address: z.string().optional(),
        city: z.string().max(100).optional(),
        state: z.string().length(2).optional(),
        website: z.string().url().optional().or(z.literal("")),
        instagram: z
          .string()
          .max(100)
          .refine(
            (value) => value === "" || INSTAGRAM_HANDLE_REGEX.test(value),
            INSTAGRAM_HANDLE_ERROR
          )
          .optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        hours: z.any().optional(),
        categories: z.array(z.string()).optional(),
        isEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user is admin or place member
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
      });

      const isAdmin = user?.role === "admin";
      const isMember = await ctx.db.query.placeMembers.findFirst({
        where: and(
          eq(placeMembers.userId, ctx.auth.userId),
          eq(placeMembers.placeId, input.placeId)
        ),
      });

      if (!isAdmin && !isMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to update this place",
        });
      }

      const existingPlace = await ctx.db.query.places.findFirst({
        where: eq(places.id, input.placeId),
        columns: { logoImageUrl: true, coverImageUrl: true },
      });
      if (!existingPlace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Place not found" });
      }

      // If slug is being updated, check if it's already taken
      if (input.slug) {
        const existing = await ctx.db.query.places.findFirst({
          where: and(eq(places.slug, input.slug), ne(places.id, input.placeId)),
        });

        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A place with this slug already exists",
          });
        }
      }

      const { placeId, categories, ...updates } = input;

      // Filter out undefined values, but keep empty strings (for clearing fields)
      const filteredUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, value]) => value !== undefined)
      );

      const [updated] = await withStoredImageReplacements({
        db: ctx.db,
        replacements: [
          {
            oldUrl: existingPlace.logoImageUrl,
            newUrl:
              input.logoImageUrl === undefined
                ? existingPlace.logoImageUrl
                : input.logoImageUrl || null,
          },
          {
            oldUrl: existingPlace.coverImageUrl,
            newUrl:
              input.coverImageUrl === undefined
                ? existingPlace.coverImageUrl
                : input.coverImageUrl || null,
          },
        ],
        persist: () =>
          ctx.db
            .update(places)
            .set({ ...filteredUpdates, updatedAt: new Date() })
            .where(eq(places.id, placeId))
            .returning(),
      });

      if (categories !== undefined) {
        await setPlaceCategoryKeys(ctx.db, placeId, categories, {
          activeOnly: true,
        });
      }

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Place not found",
        });
      }

      const refreshed = await ctx.db.query.places.findFirst({
        where: eq(places.id, placeId),
        with: {
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      return refreshed ? mapPlaceCategoryData(refreshed) : updated;
    }),

  getPlaceMembers: protectedProcedure
    .input(z.object({ placeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Check if user is admin or place member
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
      });

      const isAdmin = user?.role === "admin";
      const isMember = await ctx.db.query.placeMembers.findFirst({
        where: and(
          eq(placeMembers.userId, ctx.auth.userId),
          eq(placeMembers.placeId, input.placeId)
        ),
      });

      if (!isAdmin && !isMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to view place members",
        });
      }

      const members = await ctx.db.query.placeMembers.findMany({
        where: eq(placeMembers.placeId, input.placeId),
        with: {
          user: true,
        },
        orderBy: [desc(placeMembers.createdAt)],
      });

      return members;
    }),
});
