import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { supportTicketActivity, supportTickets } from "@/server/db/schema";
import { ensureDbUser } from "@/server/utils/ensure-db-user";

const submissionSchema = z.object({
  type: z.enum(["help", "bug", "feedback", "feature-request"]),
  severity: z.enum(["low", "medium", "high"]),
  subject: z.string().trim().min(3).max(255),
  message: z.string().trim().min(10).max(5_000),
  reportedEntityType: z.enum(["user", "place", "event"]).optional(),
  reportedEntityId: z.string().trim().min(1).max(255).optional(),
}).refine(
  (submission) =>
    Boolean(submission.reportedEntityType) ===
    Boolean(submission.reportedEntityId),
  { message: "Reported entity type and ID must be provided together." }
);

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = submissionSchema.parse(await request.json());
    await ensureDbUser(db, userId);

    const ticket = await db.transaction(async (transaction) => {
      const [createdTicket] = await transaction
        .insert(supportTickets)
        .values({
          userId,
          type: body.type,
          severity: body.severity,
          subject: body.subject,
          message: body.message,
          reportedEntityType: body.reportedEntityType,
          reportedEntityId: body.reportedEntityId,
        })
        .returning();

      if (!createdTicket) {
        throw new Error("Support ticket was not created");
      }

      await transaction.insert(supportTicketActivity).values({
        ticketId: createdTicket.id,
        actorUserId: userId,
        type: "created",
        metadata: {
          type: createdTicket.type,
          status: createdTicket.status,
          severity: createdTicket.severity,
          reportedEntityType: createdTicket.reportedEntityType,
          reportedEntityId: createdTicket.reportedEntityId,
        },
      });

      return createdTicket;
    });

    return NextResponse.json({ success: true, ticketId: ticket.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Please check the form and try again." },
        { status: 400 }
      );
    }

    console.error("Mobile support ticket submission error:", error);
    return NextResponse.json(
      { error: "We couldn't send your message. Please try again." },
      { status: 500 }
    );
  }
}
