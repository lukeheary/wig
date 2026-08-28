import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/server/db";
import { metroAreas, users } from "@/server/db/schema";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { role: true },
    });
    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
