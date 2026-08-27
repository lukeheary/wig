import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { placeMembers, users } from "@/server/db/schema";

export interface MobileEventEditPermissions {
  isAdmin: boolean;
  manageablePlaceIds: Set<string>;
  placeRoleById: Map<string, "owner" | "manager" | "promoter" | "staff">;
}

export async function resolveMobileEventEditPermissions(
  userId: string | null
): Promise<MobileEventEditPermissions> {
  if (!userId) {
    return {
      isAdmin: false,
      manageablePlaceIds: new Set<string>(),
      placeRoleById: new Map(),
    };
  }

  const [user, memberships] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        role: true,
      },
    }),
    db.query.placeMembers.findMany({
      where: eq(placeMembers.userId, userId),
      columns: {
        placeId: true,
        role: true,
      },
    }),
  ]);

  return {
    isAdmin: user?.role === "admin",
    manageablePlaceIds: new Set(memberships.map((membership) => membership.placeId)),
    placeRoleById: new Map(
      memberships.map(
        (membership) => [membership.placeId, membership.role] as const
      )
    ),
  };
}

export function canEditMobileEvent(
  permissions: MobileEventEditPermissions,
  event: {
    venueId: string | null;
    organizerId: string | null;
  }
) {
  if (permissions.isAdmin) {
    return true;
  }

  return (
    (event.venueId ? permissions.manageablePlaceIds.has(event.venueId) : false) ||
    (event.organizerId ? permissions.manageablePlaceIds.has(event.organizerId) : false)
  );
}
