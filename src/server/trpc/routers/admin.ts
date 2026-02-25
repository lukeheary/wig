import { z } from "zod";
import { router, adminProcedure } from "../init";
import {
  categories,
  cities,
  eventSeries,
  metroAreas,
  places,
  placeMembers,
  scrapers,
  users,
} from "../../db/schema";
import { eq, and, or, ilike, desc, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  listCategoryOptions,
  mapPlaceCategoryData,
  setPlaceCategoryKeys,
} from "@/server/utils/categories";

const placeTypeSchema = z.enum(["venue", "organizer"]);
const placeMemberRoleSchema = z.enum(["owner", "manager", "promoter", "staff"]);
const scraperTypeSchema = z.enum(["dice", "posh", "clubcafe", "ticketmaster"]);
const categoryKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "Key must be lowercase alphanumeric with hyphens");

export const adminRouter = router({
  // ============================================================================
  // PLACE MANAGEMENT
  // ============================================================================

  createPlace: adminProcedure
    .input(
      z.object({
        type: placeTypeSchema,
        slug: z
          .string()
          .min(3)
          .max(100)
          .regex(
            /^[a-z0-9_-]+$/,
            "Slug must be lowercase alphanumeric with hyphens and underscores"
          ),
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        logoImageUrl: z.string().url().optional().or(z.literal("")),
        coverImageUrl: z.string().url().optional().or(z.literal("")),
        address: z.string().optional(),
        city: z.string().max(100).optional(),
        state: z.string().length(2, "State must be 2-letter code").optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        website: z.string().url().optional().or(z.literal("")),
        instagram: z.string().max(100).optional(),
        hours: z.any().optional(),
        categories: z.array(z.string()).optional().default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if slug already exists
      const existing = await ctx.db.query.places.findFirst({
        where: eq(places.slug, input.slug),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A place with this slug already exists",
        });
      }

      const { categories, ...rest } = input;
      const [place] = await ctx.db
        .insert(places)
        .values(rest)
        .returning();

      if (categories.length > 0) {
        await setPlaceCategoryKeys(ctx.db, place.id, categories, { activeOnly: true });
      }

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

  addPlaceMember: adminProcedure
    .input(
      z.object({
        placeId: z.string().uuid(),
        userId: z.string(),
        role: placeMemberRoleSchema.default("staff"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user exists
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Check if place exists
      const place = await ctx.db.query.places.findFirst({
        where: eq(places.id, input.placeId),
      });

      if (!place) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Place not found",
        });
      }

      // Check if already a member
      const existing = await ctx.db.query.placeMembers.findFirst({
        where: and(
          eq(placeMembers.userId, input.userId),
          eq(placeMembers.placeId, input.placeId)
        ),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a member of this place",
        });
      }

      const [member] = await ctx.db
        .insert(placeMembers)
        .values({
          userId: input.userId,
          placeId: input.placeId,
          role: input.role,
        })
        .returning();

      return member;
    }),

  removePlaceMember: adminProcedure
    .input(
      z.object({
        placeId: z.string().uuid(),
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(placeMembers)
        .where(
          and(
            eq(placeMembers.userId, input.userId),
            eq(placeMembers.placeId, input.placeId)
          )
        )
        .returning();

      if (result.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Place membership not found",
        });
      }

      return { success: true };
    }),

  listAllPlaces: adminProcedure
    .input(
      z.object({
        type: placeTypeSchema.optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];

      if (input.type) {
        conditions.push(eq(places.type, input.type));
      }

      if (input.search) {
        conditions.push(
          or(
            ilike(places.name, `%${input.search}%`),
            ilike(places.slug, `%${input.search}%`)
          )!
        );
      }

      const results = await ctx.db.query.places.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(places.createdAt)],
        with: {
          members: true,
          follows: true,
          scraperConfigs: true,
          categoryLinks: {
            with: {
              category: true,
            },
          },
        },
      });

      return results.map(mapPlaceCategoryData);
    }),

  // ============================================================================
  // SCRAPER MANAGEMENT
  // ============================================================================

  listScrapers: adminProcedure
    .input(
      z
        .object({
          placeId: z.string().uuid().optional(),
          scraper: scraperTypeSchema.optional(),
          search: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];

      if (input?.placeId) {
        conditions.push(eq(scrapers.placeId, input.placeId));
      }

      if (input?.scraper) {
        conditions.push(eq(scrapers.scraper, input.scraper));
      }

      if (input?.search) {
        conditions.push(ilike(scrapers.searchString, `%${input.search}%`));
      }

      const rows = await ctx.db.query.scrapers.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        with: {
          place: true,
        },
        orderBy: [desc(scrapers.updatedAt)],
      });

      if (!input?.search) {
        return rows;
      }

      const lower = input.search.toLowerCase();
      return rows.filter(
        (row) =>
          row.searchString.toLowerCase().includes(lower) ||
          row.place.name.toLowerCase().includes(lower)
      );
    }),

  getScraperForPlace: adminProcedure
    .input(z.object({ placeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return await ctx.db.query.scrapers.findFirst({
        where: eq(scrapers.placeId, input.placeId),
        with: {
          place: true,
        },
      });
    }),

  upsertPlaceScraper: adminProcedure
    .input(
      z.object({
        placeId: z.string().uuid(),
        scraper: scraperTypeSchema.optional().nullable(),
        searchString: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const place = await ctx.db.query.places.findFirst({
        where: eq(places.id, input.placeId),
      });

      if (!place) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Place not found",
        });
      }

      const trimmedSearchString = input.searchString?.trim() ?? "";
      const shouldClear = !input.scraper || trimmedSearchString.length === 0;

      if (shouldClear) {
        await ctx.db
          .delete(scrapers)
          .where(eq(scrapers.placeId, input.placeId))
          .returning();

        return { success: true, scraper: null };
      }

      const scraper = input.scraper;
      if (!scraper) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scraper type is required",
        });
      }

      const existing = await ctx.db.query.scrapers.findFirst({
        where: eq(scrapers.placeId, input.placeId),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(scrapers)
          .set({
            scraper,
            searchString: trimmedSearchString,
            updatedAt: new Date(),
          })
          .where(eq(scrapers.id, existing.id))
          .returning();

        return { success: true, scraper: updated };
      }

      const [created] = await ctx.db
        .insert(scrapers)
        .values({
          placeId: input.placeId,
          scraper,
          searchString: trimmedSearchString,
        })
        .returning();

      return { success: true, scraper: created };
    }),

  deleteScraper: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(scrapers)
        .where(eq(scrapers.id, input.id))
        .returning();

      if (result.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scraper not found",
        });
      }

      return { success: true };
    }),

  // ============================================================================
  // CATEGORY MANAGEMENT
  // ============================================================================

  listCategories: adminProcedure.query(async ({ ctx }) => {
    return await listCategoryOptions(ctx.db, { includeInactive: true });
  }),

  createCategory: adminProcedure
    .input(
      z.object({
        key: categoryKeySchema,
        label: z.string().min(1).max(100),
        sortOrder: z.number().int().min(0).default(0),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const key = input.key.trim().toLowerCase();
      const existing = await ctx.db.query.categories.findFirst({
        where: eq(categories.key, key),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A category with this key already exists",
        });
      }

      const [created] = await ctx.db
        .insert(categories)
        .values({
          key,
          label: input.label.trim(),
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        })
        .returning();

      return created;
    }),

  updateCategory: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        key: categoryKeySchema.optional(),
        label: z.string().min(1).max(100).optional(),
        sortOrder: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.categories.findFirst({
        where: eq(categories.id, input.id),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Category not found",
        });
      }

      const nextKey = input.key?.trim().toLowerCase();
      if (nextKey) {
        const keyConflict = await ctx.db.query.categories.findFirst({
          where: and(eq(categories.key, nextKey), ne(categories.id, input.id)),
        });

        if (keyConflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another category already uses this key",
          });
        }
      }

      const didRenameKey = Boolean(nextKey && nextKey !== existing.key);
      const [updated] = await ctx.db.transaction(async (tx) => {
        const [updatedCategory] = await tx
          .update(categories)
          .set({
            key: nextKey ?? undefined,
            label: input.label?.trim(),
            sortOrder: input.sortOrder,
            isActive: input.isActive,
            updatedAt: new Date(),
          })
          .where(eq(categories.id, input.id))
          .returning();

        // Recurring series store category keys directly in JSON.
        // If a key is renamed, rewrite existing series to the new key.
        if (didRenameKey && nextKey) {
          const affectedSeries = await tx
            .select({
              id: eventSeries.id,
              categories: eventSeries.categories,
            })
            .from(eventSeries)
            .where(sql`${eventSeries.categories} ? ${existing.key}`);

          for (const series of affectedSeries) {
            const currentKeys = Array.isArray(series.categories)
              ? series.categories.filter(
                  (value): value is string => typeof value === "string"
                )
              : [];

            const nextKeys = Array.from(
              new Set(
                currentKeys.map((key) => (key === existing.key ? nextKey : key))
              )
            );

            const changed =
              nextKeys.length !== currentKeys.length ||
              nextKeys.some((key, index) => key !== currentKeys[index]);

            if (!changed) continue;

            await tx
              .update(eventSeries)
              .set({
                categories: nextKeys,
                updatedAt: new Date(),
              })
              .where(eq(eventSeries.id, series.id));
          }
        }

        return [updatedCategory];
      });

      return updated;
    }),

  deleteCategory: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.categories.findFirst({
        where: eq(categories.id, input.id),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Category not found",
        });
      }

      await ctx.db.delete(categories).where(eq(categories.id, input.id));

      return { id: input.id };
    }),

  // ============================================================================
  // USER SEARCH
  // ============================================================================

  searchUsers: adminProcedure
    .input(
      z.object({
        query: z.string().min(1),
        limit: z.number().min(1).max(20).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const terms = input.query.trim().split(/\s+/).filter(Boolean);

      const nameSearchConditions = terms.map((term) =>
        or(
          ilike(users.username, `%${term}%`),
          ilike(users.email, `%${term}%`),
          ilike(users.firstName, `%${term}%`),
          ilike(users.lastName, `%${term}%`)
        )
      );

      const results = await ctx.db.query.users.findMany({
        where:
          nameSearchConditions.length > 0
            ? and(...nameSearchConditions)
            : undefined,
        limit: input.limit,
        orderBy: [desc(users.createdAt)],
      });

      return results;
    }),

  // ============================================================================
  // METRO AREA MANAGEMENT
  // ============================================================================

  listMetroAreas: adminProcedure.query(async ({ ctx }) => {
    const results = await ctx.db
      .select()
      .from(metroAreas)
      .orderBy(metroAreas.name);

    return results;
  }),

  createMetroArea: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        state: z.string().length(2, "State must be a 2-letter code"),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        radiusMiles: z.number().min(1).max(200).default(20),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.metroAreas.findFirst({
        where: and(
          eq(metroAreas.name, input.name),
          eq(metroAreas.state, input.state)
        ),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A metro area with this name and state already exists",
        });
      }

      const [metro] = await ctx.db.insert(metroAreas).values(input).returning();

      return metro;
    }),

  updateMetroArea: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100),
        state: z.string().length(2, "State must be a 2-letter code"),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        radiusMiles: z.number().min(1).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const existing = await ctx.db.query.metroAreas.findFirst({
        where: eq(metroAreas.id, id),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Metro area not found",
        });
      }

      // Check for name/state conflict with other metro areas
      const conflict = await ctx.db.query.metroAreas.findFirst({
        where: and(
          eq(metroAreas.name, data.name),
          eq(metroAreas.state, data.state)
        ),
      });

      if (conflict && conflict.id !== id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Another metro area with this name and state already exists",
        });
      }

      const [updated] = await ctx.db
        .update(metroAreas)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(metroAreas.id, id))
        .returning();

      return updated;
    }),

  deleteMetroArea: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(metroAreas)
        .where(eq(metroAreas.id, input.id))
        .returning();

      if (result.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Metro area not found",
        });
      }

      return { success: true };
    }),
});
