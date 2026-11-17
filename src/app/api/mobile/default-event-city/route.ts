import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { defaultEventCityUpdateSchema } from "@/lib/default-event-city";
import { db } from "@/server/db";
import { metroAreas, users } from "@/server/db/schema";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [user, availableCities] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { metroAreaId: true },
    }),
    db
      .select({
        id: metroAreas.id,
        name: metroAreas.name,
        state: metroAreas.state,
      })
      .from(metroAreas)
      .where(eq(metroAreas.isEnabled, true))
      .orderBy(asc(metroAreas.name), asc(metroAreas.state)),
  ]);
  if (!user)
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json(
    {
      defaultCity:
        availableCities.find((city) => city.id === user.metroAreaId) ?? null,
      availableCities,
    },
    { headers }
  );
}

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = defaultEventCityUpdateSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Choose an available city." },
      { status: 400 }
    );
  const metroAreaId = parsed.data.metroAreaId;
  const city = await db.query.metroAreas.findFirst({
    where: and(eq(metroAreas.id, metroAreaId), eq(metroAreas.isEnabled, true)),
    columns: { id: true, name: true, state: true },
  });
  if (!city)
    return NextResponse.json(
      {
        error: "That city is no longer available. Please choose another city.",
      },
      { status: 400 }
    );
  const [saved] = await db
    .update(users)
    .set({ metroAreaId: metroAreaId, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ userId: users.id });
  if (!saved)
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json({ defaultCity: city }, { headers });
}
