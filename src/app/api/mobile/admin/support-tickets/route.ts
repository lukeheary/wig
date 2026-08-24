import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/server/db";
import {
  notifications,
  supportTicketActivity,
  supportTickets,
  users,
} from "@/server/db/schema";

const statusSchema = z.enum([
  "open",
  "in-review",
  "closed",
  "planned",
  "resolved",
]);

const updateSchema = z.object({
  ticketId: z.string().uuid(),
  status: statusSchema,
});

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true },
  });
  if (user?.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { userId };
}

export async function GET() {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const tickets = await db
    .select({
      id: supportTickets.id,
      userId: supportTickets.userId,
      type: supportTickets.type,
      severity: supportTickets.severity,
      status: supportTickets.status,
      subject: supportTickets.subject,
      message: supportTickets.message,
      reportedEntityType: supportTickets.reportedEntityType,
      reportedEntityId: supportTickets.reportedEntityId,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
      userEmail: users.email,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      avatarImageUrl: users.avatarImageUrl,
    })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.userId, users.id))
    .orderBy(desc(supportTickets.createdAt));

  return NextResponse.json({ tickets });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  try {
    const input = updateSchema.parse(await request.json());
    const existing = await db.query.supportTickets.findFirst({
      where: eq(supportTickets.id, input.ticketId),
    });

    if (!existing) {
      return NextResponse.json({ error: "Support request not found" }, { status: 404 });
    }

    if (existing.status === input.status) {
      return NextResponse.json({ ticket: existing });
    }

    const [updated] = await db
      .update(supportTickets)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(supportTickets.id, input.ticketId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Support request not found" }, { status: 404 });
    }

    const statusLabels = {
      open: "Open",
      "in-review": "In Review",
      closed: "Closed",
      planned: "Planned",
      resolved: "Resolved",
    } as const;

    await db.transaction(async (transaction) => {
      await transaction.insert(supportTicketActivity).values({
        ticketId: existing.id,
        actorUserId: admin.userId,
        type: "status_changed",
        metadata: { fromStatus: existing.status, toStatus: input.status },
      });

      await transaction.insert(notifications).values({
        userId: existing.userId,
        actorUserId: admin.userId,
        type: "support_ticket_status_changed",
        entityType: "support_ticket",
        entityId: existing.id,
        title: "Ticket status updated",
        body: `Your ticket "${existing.subject}" is now ${statusLabels[input.status]}.`,
        actionUrl: "/support",
        metadata: {
          ticketId: existing.id,
          fromStatus: existing.status,
          toStatus: input.status,
        },
      });
    });

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid support request update" }, { status: 400 });
    }

    console.error("PATCH /api/mobile/admin/support-tickets failed", error);
    return NextResponse.json({ error: "Failed to update support request" }, { status: 500 });
  }
}
