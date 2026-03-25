"use client";

import { useMemo } from "react";
import { Loader2, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ActivityItem } from "@/components/friends/activity-feed";
import { EmptyStateCard } from "@/components/shared/empty-state-card";

const DEMO_ACTIVITY_ACTORS = [
  {
    id: "act-1",
    firstName: "Charlie",
    lastName: null,
    avatarImageUrl: null,
    partnerFirstName: "Jamie",
    type: "rsvp_going" as const,
  },
  {
    id: "act-2",
    firstName: "Jordan",
    lastName: null,
    avatarImageUrl: null,
    partnerFirstName: null,
    type: "rsvp_interested" as const,
  },
  {
    id: "act-3",
    firstName: "Blake",
    lastName: null,
    avatarImageUrl: null,
    partnerFirstName: "Cameron",
    type: "rsvp_going" as const,
  },
];

export function LandingRecentActivity() {
  const { data: events, isLoading } =
    trpc.event.listPublicEventsPreview.useQuery({
      limit: 4,
    });
  const activityItems = useMemo(
    () =>
      events?.slice(0, 3).map((event, index) => {
        const actor = DEMO_ACTIVITY_ACTORS[index % DEMO_ACTIVITY_ACTORS.length];

        return {
          id: `landing-activity-${event.id}`,
          actor: {
            id: actor.id,
            firstName: actor.firstName,
            lastName: actor.lastName,
            avatarImageUrl: actor.avatarImageUrl,
          },
          type: actor.type,
          entityId: event.id,
          metadata: {},
          createdAt: new Date(
            Date.now() - (index + 1) * 45 * 60 * 1000
          ).toISOString(),
          event,
          partnerFirstName: actor.partnerFirstName,
        };
      }) ?? [],
    [events]
  );

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : activityItems.length === 0 ? (
        <EmptyStateCard icon={Users} title="No recent activity" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col">
            {activityItems.map((activity) => (
              <div
                key={activity.id}
                className="relative pb-3 last:pb-0 md:pb-4"
              >
                <ActivityItem activity={activity} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
