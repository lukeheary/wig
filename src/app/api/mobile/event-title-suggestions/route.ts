import { auth } from "@clerk/nextjs/server";
import { asc, and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveMobileEventEditPermissions } from "@/app/api/mobile/event-edit-permissions";
import { accentInsensitiveLike } from "@/server/db/search";
import { db } from "@/server/db";
import { events, users } from "@/server/db/schema";

const querySchema = z.object({
  venueId: z.string().uuid(),
  query: z.string().trim().optional().default(""),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

async function currentMobileUserContext() {
  const { userId } = await auth();

  if (userId) {
    return { userId, isPreview: false };
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: {
      id: true,
    },
  });

  return {
    userId: previewUser?.id ?? null,
    isPreview: true,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const input = querySchema.parse({
      venueId: searchParams.get("venueId"),
      query: searchParams.get("query") ?? "",
      limit: searchParams.get("limit") ?? undefined,
    });
    const { userId, isPreview } = await currentMobileUserContext();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const permissions = await resolveMobileEventEditPermissions(userId);
    if (!isPreview && !permissions.isAdmin && !permissions.manageablePlaceIds.has(input.venueId)) {
      return NextResponse.json({ suggestions: [] });
    }

    const titleQuery = input.query.trim();
    const titleCondition = titleQuery
      ? accentInsensitiveLike(events.title, titleQuery)
      : undefined;
    const eventRows = await db.query.events.findMany({
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
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      suggestions.push({
        title: row.title.trim(),
        startAt: row.startAt,
        endAt: row.endAt,
      });

      if (suggestions.length >= input.limit) {
        break;
      }
    }

    return NextResponse.json({ suggestions });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid suggestion query" },
        { status: 400 }
      );
    }

    console.error("Mobile event title suggestions error:", error);
    return NextResponse.json(
      { error: "Failed to load event title suggestions" },
      { status: 500 }
    );
  }
}
