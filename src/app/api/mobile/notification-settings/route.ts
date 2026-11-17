import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { userNotificationPreferences } from "@/server/db/schema";
import {
  notificationPreferencesSchema,
  resolveNotificationPreferences,
} from "@/lib/notification-preferences";

export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const saved = await db.query.userNotificationPreferences.findFirst({
    where: eq(userNotificationPreferences.userId, userId),
    columns: { preferences: true },
  });
  return NextResponse.json(
    { preferences: resolveNotificationPreferences(saved?.preferences) },
    {
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = notificationPreferencesSchema
    .partial()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: "Invalid notification settings" },
      { status: 400 }
    );
  }
  const [saved] = await db
    .insert(userNotificationPreferences)
    .values({
      userId,
      preferences: parsed.data,
    })
    .onConflictDoUpdate({
      target: userNotificationPreferences.userId,
      set: {
        // Merge each changed switch atomically so devices cannot overwrite unrelated choices.
        preferences: sql`${userNotificationPreferences.preferences} || ${JSON.stringify(parsed.data)}::jsonb`,
        updatedAt: new Date(),
      },
    })
    .returning({ preferences: userNotificationPreferences.preferences });
  return NextResponse.json({
    preferences: resolveNotificationPreferences(saved.preferences),
  });
}
