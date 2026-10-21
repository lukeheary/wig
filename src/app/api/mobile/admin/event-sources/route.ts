import { auth } from "@clerk/nextjs/server";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { eventSourceVisibility, users } from "@/server/db/schema";
import { EVENT_SOURCES } from "@/server/utils/event-source-visibility";

async function authorized() {
  const { userId } = await auth();
  const user = userId
    ? await db.query.users.findFirst({ where: eq(users.id, userId) })
    : process.env.NODE_ENV === "development"
      ? await db.query.users.findFirst({
          where: eq(users.isOnboarding, false),
          orderBy: [asc(users.createdAt)],
        })
      : null;
  return user?.role === "admin";
}

async function response() {
  const settings = await db.select().from(eventSourceVisibility);
  return NextResponse.json({
    sources: EVENT_SOURCES.map((source) => ({
      source,
      hidden:
        settings.find((setting) => setting.source === source)?.hidden ?? false,
    })),
  });
}

export async function GET() {
  if (!(await authorized()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return response();
}

const updateSchema = z.object({
  source: z.enum(EVENT_SOURCES),
  hidden: z.boolean(),
});

export async function PATCH(request: Request) {
  if (!(await authorized()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid source visibility" },
      { status: 400 }
    );
  await db
    .insert(eventSourceVisibility)
    .values(parsed.data)
    .onConflictDoUpdate({
      target: eventSourceVisibility.source,
      set: { hidden: parsed.data.hidden, updatedAt: new Date() },
    });
  return response();
}
