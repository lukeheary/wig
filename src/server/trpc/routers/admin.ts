import { z } from "zod";
import { router, adminProcedure } from "../init";
import {
  categories,
  cities,
  metroAreas,
  notifications,
  places,
  placeMembers,
  scrapers,
  scraperLogs,
  supportTicketActivity,
  supportTickets,
  users,
} from "../../db/schema";
import { eq, and, or, ilike, desc, ne, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  listCategoryOptions,
  mapPlaceCategoryData,
  setPlaceCategoryKeys,
} from "@/server/utils/categories";
import {
  INSTAGRAM_HANDLE_ERROR,
  INSTAGRAM_HANDLE_REGEX,
  PLACE_SLUG_ERROR,
  PLACE_SLUG_REGEX,
} from "@/lib/place-identifiers";

const placeTypeSchema = z.enum(["venue", "organizer"]);
const placeMemberRoleSchema = z.enum(["owner", "manager", "promoter", "staff"]);
const scraperTypeSchema = z.enum(["dice", "posh", "ticketmaster"]);
const placeScraperInputSchema = z.object({
  id: z.string().uuid().optional(),
  scraper: scraperTypeSchema,
  searchString: z.string(),
  classificationName: z.string().optional().nullable(),
});
const supportTicketStatusSchema = z.enum([
  "open",
  "in-review",
  "closed",
  "planned",
  "resolved",
]);
const categoryKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "Key must be lowercase alphanumeric with hyphens");

function normalizeMatchText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWordSet(...values: Array<string | null | undefined>) {
  return new Set(
    values
      .flatMap((value) => normalizeMatchText(value).split(" "))
      .map((value) => value.trim())
      .filter((value) => value.length > 1)
  );
}

function scoreScrapedVenueMatch(
  scraped: {
    venueName: string;
    city?: string | null;
    state?: string | null;
    address?: string | null;
  },
  place: {
    id: string;
    name: string;
    aliases: string[];
    city: string | null;
    state: string | null;
    address: string | null;
    website: string | null;
  }
) {
  const scrapedName = normalizeMatchText(scraped.venueName);
  const placeName = normalizeMatchText(place.name);
  const aliasMatch = place.aliases.some(
    (alias) => normalizeMatchText(alias) === scrapedName
  );

  if (!scrapedName || !placeName) {
    return -1;
  }

  const scrapedCity = normalizeMatchText(scraped.city);
  const scrapedState = normalizeMatchText(scraped.state);
  const placeCity = normalizeMatchText(place.city);
  const placeState = normalizeMatchText(place.state);

  if (scrapedState && placeState && scrapedState !== placeState) {
    return -1;
  }

  const locationWords = getWordSet(
    scraped.city,
    scraped.state,
    scraped.address,
    place.city,
    place.state,
    place.address
  );

  const stripLocationWords = (value: string) =>
    value
      .split(" ")
      .filter((word) => !locationWords.has(word))
      .join(" ")
      .trim();

  const scrapedCore = stripLocationWords(scrapedName);
  const placeCore = stripLocationWords(placeName);

  let score = aliasMatch ? 1000 : -1;

  if (scrapedName === placeName) {
    score = 1000;
  } else if (scrapedCore && scrapedCore === placeName) {
    score = 950;
  } else if (placeCore && scrapedName === placeCore) {
    score = 945;
  } else if (scrapedCore && placeCore && scrapedCore === placeCore) {
    score = 920;
  } else if (
    scrapedName.startsWith(`${placeName} `) &&
    stripLocationWords(scrapedName.slice(placeName.length)).length === 0
  ) {
    score = 900;
  } else if (
    placeName.startsWith(`${scrapedName} `) &&
    stripLocationWords(placeName.slice(scrapedName.length)).length === 0
  ) {
    score = 890;
  }

  if (score < 0) {
    return -1;
  }

  if (scrapedCity && placeCity && scrapedCity === placeCity) {
    score += 20;
  }

  if (scrapedState && placeState && scrapedState === placeState) {
    score += 10;
  }

  return score;
}

export const adminRouter = router({
  // ============================================================================
  // SUPPORT TICKETS
  // ============================================================================

  listSupportTickets: adminProcedure
    .input(
      z
        .object({
          status: supportTicketStatusSchema.optional(),
          search: z.string().trim().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];

      if (input?.status) {
        conditions.push(eq(supportTickets.status, input.status));
      }

      if (input?.search) {
        conditions.push(
          or(
            ilike(supportTickets.subject, `%${input.search}%`),
            ilike(supportTickets.message, `%${input.search}%`),
            ilike(users.email, `%${input.search}%`),
            ilike(users.username, `%${input.search}%`)
          )!
        );
      }

      return ctx.db
        .select({
          id: supportTickets.id,
          userId: supportTickets.userId,
          type: supportTickets.type,
          severity: supportTickets.severity,
          status: supportTickets.status,
          subject: supportTickets.subject,
          message: supportTickets.message,
          createdAt: supportTickets.createdAt,
          updatedAt: supportTickets.updatedAt,
          userEmail: users.email,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          avatarImageUrl: users.avatarImageUrl,
        })
        .from(supportTickets)
        .innerJoin(users, eq(supportTickets.userId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(supportTickets.createdAt));
    }),

  updateSupportTicketStatus: adminProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        status: supportTicketStatusSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existingTicket = await ctx.db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, input.ticketId),
      });

      if (!existingTicket) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Support ticket not found",
        });
      }

      if (existingTicket.status === input.status) {
        return existingTicket;
      }

      const [updatedTicket] = await ctx.db
        .update(supportTickets)
        .set({
          status: input.status,
          updatedAt: new Date(),
        })
        .where(eq(supportTickets.id, input.ticketId))
        .returning();

      if (!updatedTicket) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Support ticket not found",
        });
      }

      const statusLabels = {
        open: "Open",
        "in-review": "In Review",
        closed: "Closed",
        planned: "Planned",
        resolved: "Resolved",
      } as const;

      await ctx.db.insert(supportTicketActivity).values({
        ticketId: existingTicket.id,
        actorUserId: ctx.auth.userId,
        type: "status_changed",
        metadata: {
          fromStatus: existingTicket.status,
          toStatus: input.status,
        },
      });

      await ctx.db.insert(notifications).values({
        userId: existingTicket.userId,
        actorUserId: ctx.auth.userId,
        type: "support_ticket_status_changed",
        entityType: "support_ticket",
        entityId: existingTicket.id,
        title: "Ticket status updated",
        body: `Your ticket "${existingTicket.subject}" is now ${statusLabels[input.status]}.`,
        actionUrl: "/support",
        metadata: {
          ticketId: existingTicket.id,
          fromStatus: existingTicket.status,
          toStatus: input.status,
        },
      });

      return updatedTicket;
    }),

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
          .regex(PLACE_SLUG_REGEX, PLACE_SLUG_ERROR),
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
        instagram: z
          .string()
          .max(100)
          .refine(
            (value) => value === "" || INSTAGRAM_HANDLE_REGEX.test(value),
            INSTAGRAM_HANDLE_ERROR
          )
          .optional(),
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
      const [place] = await ctx.db.insert(places).values(rest).returning();

      if (categories.length > 0) {
        await setPlaceCategoryKeys(ctx.db, place.id, categories, {
          activeOnly: true,
        });
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

  matchVenuesForScrapedEvents: adminProcedure
    .input(
      z.object({
        events: z
          .array(
            z.object({
              venueName: z.string(),
              city: z.string().nullable().optional(),
              state: z.string().nullable().optional(),
              address: z.string().nullable().optional(),
            })
          )
          .max(100),
      })
    )
    .query(async ({ ctx, input }) => {
      if (input.events.length === 0) {
        return [];
      }

      const venuePlaces = await ctx.db
        .select({
          id: places.id,
          name: places.name,
          aliases: places.aliases,
          city: places.city,
          state: places.state,
          address: places.address,
          website: places.website,
        })
        .from(places)
        .where(eq(places.type, "venue"));

      return input.events.map((event) => {
        const scoredMatches = venuePlaces
          .map((place) => ({
            place,
            score: scoreScrapedVenueMatch(event, place),
          }))
          .filter((item) => item.score >= 0)
          .sort((a, b) => b.score - a.score);

        const bestMatch = scoredMatches[0];
        const secondMatch = scoredMatches[1];
        const match =
          bestMatch &&
          bestMatch.score >= 900 &&
          (!secondMatch || secondMatch.score < bestMatch.score)
            ? bestMatch.place
            : null;

        return {
          venueName: event.venueName,
          match,
        };
      });
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
      const scraper = await ctx.db.query.scrapers.findFirst({
        where: eq(scrapers.placeId, input.placeId),
        with: {
          place: true,
        },
      });

      return scraper ?? null;
    }),

  replacePlaceScrapers: adminProcedure
    .input(
      z.object({
        placeId: z.string().uuid(),
        scrapers: z.array(placeScraperInputSchema),
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

      const normalizedScrapers = input.scrapers.map((scraperConfig) => {
        const trimmedSearchString = scraperConfig.searchString.trim();
        const trimmedClassificationName =
          scraperConfig.classificationName?.trim() ?? "";

        return {
          id: scraperConfig.id,
          scraper: scraperConfig.scraper,
          searchString: trimmedSearchString,
          classificationName:
            scraperConfig.scraper === "ticketmaster" &&
            trimmedClassificationName.length > 0
              ? trimmedClassificationName
              : null,
        };
      });

      const incompleteScraper = normalizedScrapers.find(
        (scraperConfig) => scraperConfig.searchString.length === 0
      );

      if (incompleteScraper) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Each scraper must include a search string",
        });
      }

      const savedScrapers = await ctx.db.transaction(async (tx) => {
        const existingScrapers = await tx.query.scrapers.findMany({
          where: eq(scrapers.placeId, input.placeId),
        });

        const existingIds = new Set(existingScrapers.map((row) => row.id));
        for (const scraperConfig of normalizedScrapers) {
          if (scraperConfig.id && !existingIds.has(scraperConfig.id)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "One or more scraper rows do not belong to this place",
            });
          }
        }

        const incomingIds = normalizedScrapers
          .map((scraperConfig) => scraperConfig.id)
          .filter((id): id is string => Boolean(id));

        const scraperIdsToDelete = existingScrapers
          .map((row) => row.id)
          .filter((id) => !incomingIds.includes(id));

        if (scraperIdsToDelete.length > 0) {
          await tx.delete(scrapers).where(inArray(scrapers.id, scraperIdsToDelete));
        }

        const nextScrapers = [];
        for (const scraperConfig of normalizedScrapers) {
          if (scraperConfig.id) {
            const [updated] = await tx
              .update(scrapers)
              .set({
                scraper: scraperConfig.scraper,
                searchString: scraperConfig.searchString,
                classificationName: scraperConfig.classificationName,
                updatedAt: new Date(),
              })
              .where(eq(scrapers.id, scraperConfig.id))
              .returning();

            nextScrapers.push(updated);
            continue;
          }

          const [created] = await tx
            .insert(scrapers)
            .values({
              placeId: input.placeId,
              scraper: scraperConfig.scraper,
              searchString: scraperConfig.searchString,
              classificationName: scraperConfig.classificationName,
            })
            .returning();

          nextScrapers.push(created);
        }

        return nextScrapers;
      });

      return { success: true, scrapers: savedScrapers };
    }),

  upsertPlaceScraper: adminProcedure
    .input(
      z.object({
        placeId: z.string().uuid(),
        scraper: scraperTypeSchema.optional().nullable(),
        searchString: z.string().optional().nullable(),
        classificationName: z.string().optional().nullable(),
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
      const trimmedClassificationName = input.classificationName?.trim() ?? "";
      const shouldClear = !input.scraper || trimmedSearchString.length === 0;

      if (shouldClear) {
        await ctx.db
          .delete(scrapers)
          .where(eq(scrapers.placeId, input.placeId))
          .returning();

        return { success: true, scraper: null };
      }

      const scraper = input.scraper;
      const classificationName =
        scraper === "ticketmaster" && trimmedClassificationName.length > 0
          ? trimmedClassificationName
          : null;
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
            classificationName,
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
          classificationName,
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

      const [updated] = await ctx.db
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

  listScraperLogs: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(200) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(scraperLogs)
        .orderBy(desc(scraperLogs.ranAt))
        .limit(input.limit);
    }),
});
