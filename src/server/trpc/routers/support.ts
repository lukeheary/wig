import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../init";
import { supportTicketActivity, supportTickets } from "@/server/db/schema";

const supportTicketTypeSchema = z.enum([
  "help",
  "bug",
  "feedback",
  "feature-request",
]);

export const supportRouter = router({
  listMine: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.supportTickets.findMany({
      where: eq(supportTickets.userId, ctx.auth.userId),
      orderBy: [desc(supportTickets.createdAt)],
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        type: supportTicketTypeSchema,
        subject: z.string().trim().min(3).max(255),
        message: z.string().trim().min(10).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [supportTicket] = await ctx.db
        .insert(supportTickets)
        .values({
          userId: ctx.auth.userId,
          type: input.type,
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
          },
        });
      }

      return supportTicket;
    }),
});
