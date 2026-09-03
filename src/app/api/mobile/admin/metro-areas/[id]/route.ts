import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/server/db";
import { metroAreas, users } from "@/server/db/schema";

type RouteContext = { params: Promise<{ id: string }> };

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true },
  });
  return user?.role === "admin"
    ? null
    : NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const authorizationError = await requireAdmin();
    if (authorizationError) return authorizationError;
    const { userId } = await auth();
    const id = z.string().uuid().parse((await context.params).id);
    const input = z
      .object({
        isEnabled: z.boolean().optional(),
        selectForCurrentUser: z.boolean().optional(),
      })
      .refine(
        (value) => value.isEnabled !== undefined || value.selectForCurrentUser === true
      )
      .parse(await request.json());
    const [updated] = input.isEnabled === undefined
      ? await db.select().from(metroAreas).where(eq(metroAreas.id, id))
      : await db
          .update(metroAreas)
          .set({ isEnabled: input.isEnabled, updatedAt: new Date() })
          .where(eq(metroAreas.id, id))
          .returning();
    if (!updated) {
      return NextResponse.json({ error: "Metro area not found" }, { status: 404 });
    }
    if (input.selectForCurrentUser && userId) {
      await db
        .update(users)
        .set({ metroAreaId: id, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid metro area update" }, { status: 400 });
    }
    console.error("PATCH /api/mobile/admin/metro-areas/[id] failed", error);
    return NextResponse.json({ error: "Failed to update metro area." }, { status: 500 });
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const authorizationError = await requireAdmin();
    if (authorizationError) return authorizationError;

    const id = z.string().uuid().parse((await context.params).id);
    const deleted = await db
      .delete(metroAreas)
      .where(eq(metroAreas.id, id))
      .returning({ id: metroAreas.id });

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: "Metro area not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid metro area ID" },
        { status: 400 }
      );
    }
    console.error("DELETE /api/mobile/admin/metro-areas/[id] failed", error);
    return NextResponse.json(
      { error: "Failed to delete metro area." },
      { status: 500 }
    );
  }
}
