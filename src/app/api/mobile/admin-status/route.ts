import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/server/db";
import { users } from "@/server/db/schema";

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ isAdmin: false });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        role: true,
      },
    });

    return NextResponse.json({ isAdmin: user?.role === "admin" });
  } catch (error) {
    console.error("GET /api/mobile/admin-status failed", error);
    return NextResponse.json(
      { error: "Failed to determine admin status." },
      { status: 500 }
    );
  }
}
