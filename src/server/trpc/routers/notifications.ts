import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../init";
import { notifications } from "@/server/db/schema";

export const notificationsRouter = router({
  listRecent: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.notifications.findMany({
      where: eq(notifications.userId, ctx.auth.userId),
      orderBy: [desc(notifications.createdAt)],
      limit: 50,
      with: {
        actor: true,
      },
    });
  }),

  listUnread: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.notifications.findMany({
      where: and(
        eq(notifications.userId, ctx.auth.userId),
        isNull(notifications.readAt)
      ),
      orderBy: [desc(notifications.createdAt)],
      limit: 20,
    });
  }),

  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [result] = await ctx.db
      .select({
        unreadCount: sql<number>`count(*)::int`,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.auth.userId),
          isNull(notifications.readAt)
        )
      );

    return { unreadCount: result?.unreadCount ?? 0 };
  }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, ctx.auth.userId),
          isNull(notifications.readAt)
        )
      );

    return { success: true };
  }),
});
