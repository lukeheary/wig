import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../init";
import { supportTicketActivity, supportTickets } from "@/server/db/schema";
import { ensureDbUser } from "@/server/utils/ensure-db-user";

const supportTicketTypeSchema = z.enum([
  "help",
  "bug",
  "feedback",
  "feature-request",
]);

const supportTicketStatusSchema = z.enum([
  "open",
  "in-review",
  "closed",
  "planned",
  "resolved",
]);

const supportTicketSeveritySchema = z.enum(["low", "medium", "high"]);

export const supportRouter = router({
  listMine: protectedProcedure
    .input(
      z
        .object({
          status: supportTicketStatusSchema.optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      await ensureDbUser(ctx.db, ctx.auth.userId);

      return ctx.db.query.supportTickets.findMany({
        where: input?.status
          ? and(
              eq(supportTickets.userId, ctx.auth.userId),
              eq(supportTickets.status, input.status)
            )
          : eq(supportTickets.userId, ctx.auth.userId),
        orderBy: [desc(supportTickets.createdAt)],
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        type: supportTicketTypeSchema,
        severity: supportTicketSeveritySchema.default("low"),
        subject: z.string().trim().min(3).max(255),
        message: z.string().trim().min(10).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ensureDbUser(ctx.db, ctx.auth.userId);

      const [supportTicket] = await ctx.db
        .insert(supportTickets)
        .values({
          userId: ctx.auth.userId,
          type: input.type,
          severity: input.severity,
          subject: input.subject,
          message: input.message,
        })
        .returning();

      if (supportTicket) {
        await ctx.db.insert(supportTicketActivity).values({
          ticketId: supportTicket.id,
          actorUserId: ctx.auth.userId,
          type: "created",
          metadata: {
            type: supportTicket.type,
            status: supportTicket.status,
            severity: supportTicket.severity,
          },
        });
      }

      return supportTicket;
    }),
});
