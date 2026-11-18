import { and, eq, sql } from "drizzle-orm";
import type { db } from "../db";
import { eventRsvps } from "../db/schema";

type RsvpWrite = typeof eventRsvps.$inferInsert;

/** The caller resolves partnerUserId from the actor's accepted relationship. */
export async function saveEventRsvp(
  database: Pick<typeof db, "transaction">,
  input: {
    userId: string;
    eventId: string;
    status: RsvpWrite["status"];
    notGoingReason: RsvpWrite["notGoingReason"];
    partnerUserId: string | null;
    includePartner: boolean;
  }
) {
  const { userId, eventId, status, notGoingReason, partnerUserId } = input;
  const includedPartner = Boolean(partnerUserId) && input.includePartner;
  return database.transaction(async (tx) => {
    const writes: RsvpWrite[] = [
      { userId, eventId, status, notGoingReason, partnerRsvpByUserId: null },
    ];
    if (includedPartner && partnerUserId) {
      writes.push({
        userId: partnerUserId,
        eventId,
        status,
        notGoingReason,
        partnerRsvpByUserId: userId,
      });
    }
    // Either partner can update the pair. Stable ordering also makes competing
    // updates from opposite partners acquire row locks in the same order.
    writes.sort((a, b) => a.userId.localeCompare(b.userId));
    const saved = await tx
      .insert(eventRsvps)
      .values(writes)
      .onConflictDoUpdate({
        target: [eventRsvps.userId, eventRsvps.eventId],
        set: {
          status,
          notGoingReason,
          partnerRsvpByUserId: sql`excluded.partner_rsvp_by_user_id`,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (partnerUserId && !includedPartner) {
      // Preserve independently saved partner RSVPs when opting out.
      await tx.delete(eventRsvps).where(and(
        eq(eventRsvps.userId, partnerUserId),
        eq(eventRsvps.eventId, eventId),
        eq(eventRsvps.partnerRsvpByUserId, userId)
      ));
    }
    const rsvp = saved.find((row) => row.userId === userId);
    if (!rsvp) throw new Error("RSVP was not saved");
    return { rsvp, includedPartner };
  });
}
