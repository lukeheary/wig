import { auth } from "@clerk/nextjs/server";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { userPartners, users } from "@/server/db/schema";
import { deleteNotificationsForEntity } from "@/server/utils/notifications";

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

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_: Request, context: RouteContext) {
  const userId = await currentMobileUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const partnerRequest = await db.query.userPartners.findFirst({
    where: eq(userPartners.id, id),
  });

  if (!partnerRequest) {
    return NextResponse.json({ error: "Partner request not found" }, { status: 404 });
  }

  if (partnerRequest.requesterId !== userId && partnerRequest.recipientId !== userId) {
    return NextResponse.json(
      { error: "You cannot decline this partner request" },
      { status: 403 }
    );
  }

  await db.delete(userPartners).where(eq(userPartners.id, id));

  await deleteNotificationsForEntity(
    {
      entityType: "partner_request",
      entityIds: [id],
    },
    db
  );

  return NextResponse.json({});
}
