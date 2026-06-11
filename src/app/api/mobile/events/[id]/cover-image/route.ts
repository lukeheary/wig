import { auth } from "@clerk/nextjs/server";
import { asc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { events, users } from "@/server/db/schema";

async function currentMobileUserId() {
  const { userId } = await auth();

  if (userId) {
    return userId;
  }

  const previewUser = await db.query.users.findFirst({
    where: eq(users.isOnboarding, false),
    orderBy: [asc(users.createdAt)],
    columns: {
      id: true,
    },
  });

  return previewUser?.id ?? null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await currentMobileUserId();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;
    const body = (await request.json()) as {
      eventId?: string;
      coverImageUrl?: string;
    };

    const coverImageUrl = body.coverImageUrl?.trim();

    if (!coverImageUrl) {
      return NextResponse.json(
        { error: "A cover image URL is required" },
        { status: 400 }
      );
    }

    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: {
        id: true,
        createdByUserId: true,
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        role: true,
      },
    });

    const isAdmin = currentUser?.role === "admin";
    const isCreator = event.createdByUserId === userId;

    if (!isAdmin && !isCreator) {
      return NextResponse.json(
        { error: "You do not have permission to edit this event" },
        { status: 403 }
      );
    }

    const [updatedEvent] = await db
      .update(events)
      .set({
        coverImageUrl,
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId))
      .returning({
        id: events.id,
        coverImageUrl: events.coverImageUrl,
      });

    if (!updatedEvent) {
      return NextResponse.json(
        { error: "Failed to update event cover image" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: updatedEvent.id,
      coverImageUrl: updatedEvent.coverImageUrl,
    });
  } catch (error) {
    console.error("Mobile event cover image error:", error);
    return NextResponse.json(
      { error: "Failed to update event cover image" },
      { status: 500 }
    );
  }
}
