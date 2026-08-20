import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { eventSeries, events, users } from "@/server/db/schema";
import { withStoredImageReplacements } from "@/server/utils/stored-image-lifecycle";

export async function DELETE() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [user, createdEvents, createdSeries] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { avatarImageUrl: true },
      }),
      db.query.events.findMany({
        where: eq(events.createdByUserId, userId),
        columns: { coverImageUrl: true },
      }),
      db.query.eventSeries.findMany({
        where: eq(eventSeries.createdByUserId, userId),
        columns: { coverImageUrl: true },
      }),
    ]);

    await withStoredImageReplacements({
      db,
      replacements: [
        { oldUrl: user?.avatarImageUrl, newUrl: null },
        ...createdEvents.map((event) => ({
          oldUrl: event.coverImageUrl,
          newUrl: null,
        })),
        ...createdSeries.map((series) => ({
          oldUrl: series.coverImageUrl,
          newUrl: null,
        })),
      ],
      persist: () => db.delete(users).where(eq(users.id, userId)),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete mobile account data", error);
    return NextResponse.json(
      { error: "We couldn't delete your account. Please try again." },
      { status: 500 }
    );
  }
}
