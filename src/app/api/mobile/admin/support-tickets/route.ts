import { auth } from "@clerk/nextjs/server";
import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/server/db";
import {
  events,
  notifications,
  places,
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

  const reportedUserIds = tickets.flatMap((ticket) =>
    ticket.reportedEntityType === "user" && ticket.reportedEntityId
      ? [ticket.reportedEntityId]
      : []
  );
  const reportedPlaceIds = tickets.flatMap((ticket) =>
    ticket.reportedEntityType === "place" && ticket.reportedEntityId
      ? [ticket.reportedEntityId]
      : []
  );
  const reportedEventIds = tickets.flatMap((ticket) =>
    ticket.reportedEntityType === "event" && ticket.reportedEntityId
      ? [ticket.reportedEntityId]
      : []
  );

  const [reportedUsers, reportedPlaces, reportedEvents] = await Promise.all([
    reportedUserIds.length > 0
      ? db
          .select({
            id: users.id,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
            imageUrl: users.avatarImageUrl,
          })
          .from(users)
          .where(inArray(users.id, reportedUserIds))
      : [],
    reportedPlaceIds.length > 0
      ? db
          .select({
            id: places.id,
            name: places.name,
            type: places.type,
            imageUrl: places.logoImageUrl,
          })
          .from(places)
          .where(inArray(places.id, reportedPlaceIds))
      : [],
    reportedEventIds.length > 0
      ? db
          .select({
            id: events.id,
            name: events.title,
            imageUrl: events.coverImageUrl,
          })
          .from(events)
          .where(inArray(events.id, reportedEventIds))
      : [],
  ]);

  const userPreviews = new Map(
    reportedUsers.map((user) => {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
      return [
        user.id,
        {
          name: fullName || user.username,
          imageUrl: user.imageUrl,
          displayType: "User",
        },
      ] as const;
    })
  );
  const placePreviews = new Map(
    reportedPlaces.map((place) => [
      place.id,
      {
        name: place.name,
        imageUrl: place.imageUrl,
        displayType: place.type === "venue" ? "Venue" : "Organizer",
      },
    ] as const)
  );
  const eventPreviews = new Map(
    reportedEvents.map((event) => [
      event.id,
      { name: event.name, imageUrl: event.imageUrl, displayType: "Event" },
    ] as const)
  );

  const ticketsWithPreviews = tickets.map((ticket) => {
    const entityId = ticket.reportedEntityId;
    const preview = entityId
      ? ticket.reportedEntityType === "user"
        ? userPreviews.get(entityId)
        : ticket.reportedEntityType === "place"
          ? placePreviews.get(entityId)
          : ticket.reportedEntityType === "event"
            ? eventPreviews.get(entityId)
            : undefined
      : undefined;

    return {
      ...ticket,
      reportedEntityName: preview?.name ?? null,
      reportedEntityImageUrl: preview?.imageUrl ?? null,
      reportedEntityDisplayType: preview?.displayType ?? null,
    };
  });

  return NextResponse.json({ tickets: ticketsWithPreviews });
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
