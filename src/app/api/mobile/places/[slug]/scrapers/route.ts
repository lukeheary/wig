import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveMobileEventEditPermissions } from "@/app/api/mobile/event-edit-permissions";
import { db } from "@/server/db";
import { places, scrapers, users } from "@/server/db/schema";

const scraperTypeSchema = z.enum([
  "dice",
  "posh",
  "ticketmaster",
  "eventbrite",
]);

const replaceScrapersSchema = z.object({
  scrapers: z.array(
    z.object({
      id: z.string().uuid().optional().nullable(),
      scraper: scraperTypeSchema,
      searchString: z.string(),
      classificationName: z.string().optional().nullable(),
    })
  ),
});

async function currentMobileUserId() {
  const { userId } = await auth();

  if (userId) {
    return userId;
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: { id: true },
  });

  return previewUser?.id ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const place = await db.query.places.findFirst({
    where: eq(places.slug, slug),
    columns: { id: true },
    with: {
      scraperConfigs: {
        orderBy: [asc(scrapers.createdAt)],
      },
    },
  });

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  return NextResponse.json({
    scrapers: place.scraperConfigs.map((scraper) => ({
      id: scraper.id,
      scraper: scraper.scraper,
      searchString: scraper.searchString,
      classificationName: scraper.classificationName,
    })),
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const userId = await currentMobileUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const place = await db.query.places.findFirst({
      where: eq(places.slug, slug),
      columns: { id: true },
    });

    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    const permissions = await resolveMobileEventEditPermissions(userId);
    if (!permissions.isAdmin && !permissions.manageablePlaceIds.has(place.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = replaceScrapersSchema.parse(await request.json());
    const normalizedScrapers = body.scrapers.map((scraper) => {
      const trimmedSearchString = scraper.searchString.trim();
      const trimmedClassificationName =
        scraper.classificationName?.trim() ?? "";

      return {
        id: scraper.id ?? null,
        scraper: scraper.scraper,
        searchString: trimmedSearchString,
        classificationName:
          scraper.scraper === "ticketmaster" &&
          trimmedClassificationName.length > 0
            ? trimmedClassificationName
            : null,
      };
    });

    const incompleteScraper = normalizedScrapers.find(
      (scraper) => scraper.searchString.length === 0
    );

    if (incompleteScraper) {
      return NextResponse.json(
        { error: "Each scraper must include a search string" },
        { status: 400 }
      );
    }

    const savedScrapers = await db.transaction(async (tx) => {
      const existingScrapers = await tx.query.scrapers.findMany({
        where: eq(scrapers.placeId, place.id),
      });

      const existingIDs = new Set(
        existingScrapers.map((scraper) => scraper.id)
      );
      for (const scraper of normalizedScrapers) {
        if (scraper.id && !existingIDs.has(scraper.id)) {
          throw new Error(
            "One or more scraper rows do not belong to this place"
          );
        }
      }

      const incomingIDs = normalizedScrapers
        .map((scraper) => scraper.id)
        .filter((id): id is string => Boolean(id));

      const scraperIDsToDelete = existingScrapers
        .map((scraper) => scraper.id)
        .filter((id) => !incomingIDs.includes(id));

      if (scraperIDsToDelete.length > 0) {
        await tx
          .delete(scrapers)
          .where(inArray(scrapers.id, scraperIDsToDelete));
      }

      const nextScrapers = [];
      for (const scraper of normalizedScrapers) {
        if (scraper.id) {
          const [updated] = await tx
            .update(scrapers)
            .set({
              scraper: scraper.scraper,
              searchString: scraper.searchString,
              classificationName: scraper.classificationName,
              updatedAt: new Date(),
            })
            .where(eq(scrapers.id, scraper.id))
            .returning();
          nextScrapers.push(updated);
          continue;
        }

        const [created] = await tx
          .insert(scrapers)
          .values({
            placeId: place.id,
            scraper: scraper.scraper,
            searchString: scraper.searchString,
            classificationName: scraper.classificationName,
          })
          .returning();
        nextScrapers.push(created);
      }

      return nextScrapers;
    });

    return NextResponse.json({
      scrapers: savedScrapers.map((scraper) => ({
        id: scraper.id,
        scraper: scraper.scraper,
        searchString: scraper.searchString,
        classificationName: scraper.classificationName,
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save scrapers",
      },
      { status: 500 }
    );
  }
}
