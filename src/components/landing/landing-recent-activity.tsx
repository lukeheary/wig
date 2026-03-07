"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ActivityItem } from "@/components/friends/activity-feed";

const DEMO_ACTIVITY_ACTORS = [
  {
    id: "act-1",
    firstName: "Maya",
    lastName: null,
    avatarImageUrl: null,
    partnerFirstName: "Theo",
    type: "rsvp_going" as const,
  },
  {
    id: "act-2",
    firstName: "Ari",
    lastName: null,
    avatarImageUrl: null,
    partnerFirstName: null,
    type: "rsvp_interested" as const,
  },
  {
    id: "act-3",
    firstName: "Lena",
    lastName: null,
    avatarImageUrl: null,
    partnerFirstName: "Parker",
    type: "rsvp_going" as const,
  },
  {
    id: "act-4",
    firstName: "Zoe",
    lastName: null,
    avatarImageUrl: null,
    partnerFirstName: null,
    type: "rsvp_going" as const,
  },
];

export function LandingRecentActivity() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const { data: events, isLoading } = trpc.event.listPublicEventsPreview.useQuery({
    limit: 4,
  });

  useEffect(() => {
    const handleScroll = () => {
      setHasScrolled(window.scrollY > 0);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        threshold: 0.15,
      }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  const activityItems =
    events?.slice(0, 4).map((event, index) => {
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
        createdAt: new Date(Date.now() - (index + 1) * 45 * 60 * 1000).toISOString(),
        event,
        partnerFirstName: actor.partnerFirstName,
      };
    }) ?? [];
  const shouldReveal = hasScrolled && isInView;

  return (
    <div ref={sectionRef} className="space-y-6">
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : activityItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 rounded-full bg-muted/30 p-4">
            <Users className="h-8 w-8 text-muted-foreground/60" />
          </div>
          <p className="text-lg font-medium">No recent activity</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col">
            {activityItems.map((activity, index) => (
              <div
                key={activity.id}
                className={`relative pb-3 transition-all duration-700 ease-out last:pb-0 md:pb-4 ${
                  shouldReveal
                    ? "translate-y-0 opacity-100"
                    : "translate-y-8 opacity-0"
                }`}
                style={{
                  transitionDelay: shouldReveal ? `${index * 140}ms` : "0ms",
                }}
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
