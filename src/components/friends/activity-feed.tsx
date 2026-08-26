"use client";

import { trpc } from "@/lib/trpc";
import {
  GoingActivityIcon,
  InterestedActivityIcon,
  NotGoingActivityIcon,
} from "@/components/friends/activity-icons";
import { UserAvatar } from "@/components/ui/user-avatar";
import Image from "next/image";
import {
  Loader2,
  Users,
  Building2,
  Circle,
  X,
  BellDot,
  Clock3,
  RotateCcw,
} from "lucide-react";
import {
  differenceInCalendarDays,
  format,
  formatDistanceToNow,
  isToday,
  isTomorrow,
  startOfDay,
  subDays,
} from "date-fns";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatEventDate, formatRelativeEventDate } from "@/lib/utils";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { buildReturnTo, withReturnTo } from "@/lib/navigation";
import { EmptyStateCard } from "@/components/shared/empty-state-card";
import { getGenderGrammar } from "@/lib/gender-grammar";
import { getRsvpDeclineReasonPhrase, type RsvpDeclineReason } from "@/lib/rsvp";

interface ActivityItemProps {
  activity: any;
}

function getActivityTimestamp(activity: any) {
  return new Date(activity.updatedAt ?? activity.createdAt);
}

function formatInlineEventDate(
  eventDate: Date,
  event?: { timeZone?: string | null; state?: string | null } | null
) {
  const now = startOfDay(new Date());
  const normalizedEventDate = startOfDay(eventDate);
  const diff = differenceInCalendarDays(normalizedEventDate, now);

  if (diff === 0) return "tonight";
  if (diff === 1) return "tomorrow";
  if (diff > 1 && diff < 7) {
    return `on ${formatEventDate(eventDate, event?.timeZone, event?.state, {
      weekday: "long",
    })}`;
  }
  if (diff >= 7 && diff < 14) {
    return `next ${formatEventDate(eventDate, event?.timeZone, event?.state, {
      weekday: "long",
    })}`;
  }

  return `on ${formatEventDate(
    eventDate,
    event?.timeZone,
    event?.state,
    eventDate.getFullYear() === new Date().getFullYear()
      ? { month: "long", day: "numeric" }
      : { month: "long", day: "numeric", year: "numeric" }
  )}`;
}

const EVENT_UPDATE_TYPES = new Set([
  "cancelled",
  "postponed",
  "rescheduled",
  "restored",
  "updated",
]);

const HIDDEN_ACTIVITY_TYPES = new Set(["created", "created_event"]);

export function ActivityItem({ activity }: ActivityItemProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { actor, type, entityId, metadata, event } = activity;
  const place = activity.place;
  const isEventStatusUpdate = EVENT_UPDATE_TYPES.has(type);
  const shouldInlineEventDate = type === "rsvp_not_going";
  const returnTo = buildReturnTo(pathname, searchParams);
  const eventHref = withReturnTo(
    `/event/${event?.publicId ?? entityId}`,
    returnTo
  );
  const placeHref =
    place?.slug && place?.type
      ? `/${place.type === "organizer" ? "organizer" : "venue"}/${place.slug}`
      : null;

  const eventDate = event?.startAt ? new Date(event.startAt) : null;
  const isEventPast = eventDate
    ? startOfDay(eventDate) < startOfDay(new Date())
    : false;

  const eventRelativeDate = eventDate
    ? formatRelativeEventDate(eventDate)
    : null;
  const cancelledEventDatePhrase = eventDate
    ? isToday(eventDate)
      ? "tonight"
      : isTomorrow(eventDate)
        ? "tomorrow"
        : `on ${formatEventDate(eventDate, event?.timeZone, event?.state, {
            month: "long",
            day: "numeric",
          })}`
    : null;

  if (isEventStatusUpdate) {
    return null;
  }

  const renderIcon = () => {
    switch (type) {
      case "rsvp_going":
        return <GoingActivityIcon className="h-4 w-4 text-neon-teal" />;
      case "rsvp_interested":
        return <InterestedActivityIcon className="h-4 w-4 text-yellow-400" />;
      case "rsvp_not_going":
        return <NotGoingActivityIcon className="h-4 w-4 text-red-500" />;
      case "follow_venue":
        return <Building2 className="h-4 w-4 text-blue-500" />;
      case "follow_organizer":
        return <Users className="h-4 w-4 text-purple-500" />;
      case "follow_place":
        return place?.type === "organizer" ? (
          <Users className="h-4 w-4 text-purple-500" />
        ) : (
          <Building2 className="h-4 w-4 text-blue-500" />
        );
      case "cancelled":
        return <X className="h-4 w-4 text-red-500" />;
      case "postponed":
        return <Clock3 className="h-4 w-4 text-amber-500" />;
      case "rescheduled":
        return <BellDot className="h-4 w-4 text-blue-500" />;
      case "restored":
        return <RotateCcw className="h-4 w-4 text-emerald-500" />;
      case "updated":
        return <BellDot className="h-4 w-4 text-sky-500" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const renderContent = () => {
    const actorDisplayName =
      [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim() ||
      actor.username ||
      "Someone";
    const actorName = actor.username ? (
      <Link
        href={`/${actor.username}`}
        className="font-medium text-foreground hover:underline"
      >
        {actorDisplayName}
      </Link>
    ) : (
      <span className="font-medium text-foreground">{actorDisplayName}</span>
    );
    const subjectName = activity.partnerFirstName ? (
      <span className="font-medium text-foreground">
        {actor.firstName} and {activity.partnerFirstName}
      </span>
    ) : (
      actorName
    );
    const isPluralSubject = Boolean(activity.partnerFirstName);

    const entityName =
      activity.event?.title ||
      activity.venue?.name ||
      activity.organizer?.name ||
      place?.name ||
      metadata?.name ||
      metadata?.title ||
      "an entity";
    const eventTitleInline = activity.event ? (
      <>
        {activity.event.coverImageUrl ? (
          <span className="relative ml-1 mr-1.5 inline-block h-5 w-5 shrink-0 overflow-hidden rounded-[4px] bg-muted align-[-0.2em]">
            <Image
              src={activity.event.coverImageUrl}
              alt={activity.event.title || "Event image"}
              fill
              sizes="20px"
              className="object-cover"
            />
          </span>
        ) : null}
        <Link
          href={eventHref}
          className="font-medium text-neon-teal text-primary hover:underline"
        >
          {entityName}
        </Link>
      </>
    ) : (
      <span className="font-medium text-foreground">{entityName}</span>
    );
    const notGoingReason = ((
      metadata as { reason?: RsvpDeclineReason | null } | null
    )?.reason ?? null) as RsvpDeclineReason | null;
    const notGoingReasonText = (() => {
      if (!notGoingReason) return null;
      const reasonPhrase = getRsvpDeclineReasonPhrase(notGoingReason);

      if (isPluralSubject) {
        return `because they're ${reasonPhrase}`;
      }

      return `because ${getGenderGrammar(actor.gender).contractedBe} ${reasonPhrase}`;
    })();

    switch (type) {
      case "rsvp_going":
        return (
          <>
            {subjectName}{" "}
            {isEventPast
              ? "went to"
              : isPluralSubject
                ? "are going to"
                : "is going to"}{" "}
            {eventTitleInline}
            {activity.event?.venue?.name && (
              <>
                {" "}
                at{" "}
                {activity.event.venue?.slug ? (
                  <Link
                    href={`/venue/${activity.event.venue.slug}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {activity.event.venue?.name}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">
                    {activity.event.venue?.name}
                  </span>
                )}
              </>
            )}
          </>
        );
      case "rsvp_interested":
        return (
          <>
            {subjectName}{" "}
            {isEventPast
              ? isPluralSubject
                ? "were interested in"
                : "was interested in"
              : isPluralSubject
                ? "are interested in"
                : "is interested in"}{" "}
            {eventTitleInline}
            {activity.event?.venue?.name && (
              <>
                {" "}
                at{" "}
                {activity.event.venue?.slug ? (
                  <Link
                    href={`/venue/${activity.event.venue.slug}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {activity.event.venue?.name}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">
                    {activity.event.venue?.name}
                  </span>
                )}
              </>
            )}
          </>
        );
      case "rsvp_not_going":
        return (
          <>
            {subjectName} {isEventPast ? "couldn't" : "can't"} go to{" "}
            {eventTitleInline}
            {eventDate ? <> {formatInlineEventDate(eventDate, event)}</> : null}
            {notGoingReasonText ? <> {notGoingReasonText}</> : null}
          </>
        );
      case "follow_venue":
      case "follow_organizer":
      case "follow_place":
        return (
          <>
            {actorName} started following{" "}
            {placeHref ? (
              <Link
                href={placeHref}
                className="font-medium text-primary hover:underline"
              >
                {entityName}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{entityName}</span>
            )}
          </>
        );
      case "cancelled":
        return (
          <>
            <Link
              href={eventHref}
              className="font-medium text-primary hover:underline"
            >
              {entityName}
            </Link>
            {activity.event?.venue?.name && (
              <>
                {" "}
                at{" "}
                {activity.event.venue?.slug ? (
                  <Link
                    href={`/venue/${activity.event.venue.slug}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {activity.event.venue?.name}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">
                    {activity.event.venue?.name}
                  </span>
                )}
              </>
            )}
            {cancelledEventDatePhrase ? ` ${cancelledEventDatePhrase}` : ""} has
            been cancelled
          </>
        );
      case "postponed":
        return (
          <>
            <Link
              href={eventHref}
              className="font-medium text-primary hover:underline"
            >
              {entityName}
            </Link>
            {activity.event?.venue?.name && (
              <>
                {" "}
                at{" "}
                {activity.event.venue?.slug ? (
                  <Link
                    href={`/venue/${activity.event.venue.slug}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {activity.event.venue?.name}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">
                    {activity.event.venue?.name}
                  </span>
                )}
              </>
            )}{" "}
            has been postponed
          </>
        );
      case "rescheduled":
        return (
          <>
            <Link
              href={eventHref}
              className="font-medium text-primary hover:underline"
            >
              {entityName}
            </Link>
            {activity.event?.venue?.name && (
              <>
                {" "}
                at{" "}
                {activity.event.venue?.slug ? (
                  <Link
                    href={`/venue/${activity.event.venue.slug}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {activity.event.venue?.name}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">
                    {activity.event.venue?.name}
                  </span>
                )}
              </>
            )}{" "}
            has been rescheduled
          </>
        );
      case "restored":
        return (
          <>
            <Link
              href={eventHref}
              className="font-medium text-primary hover:underline"
            >
              {entityName}
            </Link>
            {activity.event?.venue?.name && (
              <>
                {" "}
                at{" "}
                {activity.event.venue?.slug ? (
                  <Link
                    href={`/venue/${activity.event.venue.slug}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {activity.event.venue?.name}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">
                    {activity.event.venue?.name}
                  </span>
                )}
              </>
            )}{" "}
            has been restored
          </>
        );
      case "updated":
        return (
          <>
            <Link
              href={eventHref}
              className="font-medium text-primary hover:underline"
            >
              {entityName}
            </Link>
            {activity.event?.venue?.name && (
              <>
                {" "}
                at{" "}
                {activity.event.venue?.slug ? (
                  <Link
                    href={`/venue/${activity.event.venue.slug}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {activity.event.venue?.name}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">
                    {activity.event.venue?.name}
                  </span>
                )}
              </>
            )}{" "}
            has been updated
          </>
        );
      default:
        return (
          <>
            {actorName} performed an action on {entityName}
          </>
        );
    }
  };

  const content = renderContent();

  return (
    <div className="flex gap-3 pb-2 last:pb-0">
      <div className="flex pt-1.5">
        <div className="relative h-11 w-11 shrink-0">
          <UserAvatar
            src={
              isEventStatusUpdate
                ? activity.event?.venue?.logoImageUrl
                : actor.avatarImageUrl
            }
            name={
              isEventStatusUpdate
                ? activity.event?.venue?.name || activity.event?.title
                : actor.firstName
            }
            className={
              isEventStatusUpdate
                ? "h-11 w-11 rounded-md border-2 border-background ring-2 ring-muted/20"
                : "-mt-1.5 h-11 w-11 rounded-full border-2 border-background ring-2 ring-muted/20"
            }
          />
          <div className="absolute -right-1 bottom-1 rounded-full bg-background bg-card p-0.5">
            {renderIcon()}
          </div>
        </div>
      </div>
      <div className="flex-1">
        <p className="text-base text-muted-foreground">
          {content}
          {!isEventStatusUpdate &&
            !shouldInlineEventDate &&
            eventRelativeDate && (
              <span className="ml-1.5 font-medium text-muted-foreground">
                {eventRelativeDate}
              </span>
            )}
        </p>
        <p className="text-xs text-muted-foreground/60 md:text-sm">
          {formatDistanceToNow(getActivityTimestamp(activity), {
            addSuffix: true,
          })}
        </p>
      </div>
    </div>
  );
}

interface ActivityFeedProps {
  limit?: number;
  hideWhenEmpty?: boolean;
  hidePastEvents?: boolean;
  groupByRecency?: boolean;
  groupHeaderClassName?: string;
  includeEventUpdates?: boolean;
  eventTiming?: "all" | "upcoming" | "past";
}

interface ActivityFeedListProps {
  activities: any[];
  groupByRecency?: boolean;
  groupHeaderClassName?: string;
}

interface HomeActivityPreviewOptions {
  limit?: number;
  hidePastEvents?: boolean;
  includeEventUpdates?: boolean;
  lastVisitedAt?: Date | null;
  missedWindowStartAt?: Date | null;
  missedWindowExpiresAt?: Date | null;
  staleAfterDays?: number;
}

interface HomeActivityPreviewResult {
  activities: any[];
  shouldStartMissedWindow: boolean;
}

function filterActivities(
  rawActivities: any[] | undefined,
  {
    hidePastEvents = false,
    eventTiming = "all",
  }: {
    hidePastEvents?: boolean;
    eventTiming?: "all" | "upcoming" | "past";
  } = {}
) {
  const visibleActivities = rawActivities?.filter(
    (activity: any) =>
      !EVENT_UPDATE_TYPES.has(activity.type) &&
      !HIDDEN_ACTIVITY_TYPES.has(activity.type)
  );

  if (eventTiming === "past") {
    return visibleActivities?.filter((activity: any) => {
      if (!activity.event?.startAt) return false;
      return (
        startOfDay(new Date(activity.event.startAt)) < startOfDay(new Date())
      );
    });
  }

  return hidePastEvents || eventTiming === "upcoming"
    ? visibleActivities?.filter((activity: any) => {
        if (!activity.event?.startAt) return true;
        const eventDate = startOfDay(new Date(activity.event.startAt));
        const today = startOfDay(new Date());
        return eventDate >= today;
      })
    : visibleActivities;
}

function selectHomePreviewActivities(
  rawActivities: any[] | undefined,
  {
    limit,
    hidePastEvents = true,
    lastVisitedAt,
    missedWindowStartAt,
    missedWindowExpiresAt,
    staleAfterDays = 1,
  }: Required<
    Pick<HomeActivityPreviewOptions, "hidePastEvents" | "staleAfterDays">
  > &
    Pick<
      HomeActivityPreviewOptions,
      | "limit"
      | "lastVisitedAt"
      | "missedWindowStartAt"
      | "missedWindowExpiresAt"
    >
): HomeActivityPreviewResult {
  const now = new Date();
  const recentCutoff = subDays(now, staleAfterDays).getTime();
  const activities = [
    ...(filterActivities(rawActivities, { hidePastEvents }) ?? []),
  ].sort(
    (a: any, b: any) =>
      getActivityTimestamp(b).getTime() - getActivityTimestamp(a).getTime()
  );

  const recentActivities = activities.filter(
    (activity) => getActivityTimestamp(activity).getTime() >= recentCutoff
  );

  const activeMissedWindowExpiresAt = missedWindowExpiresAt?.getTime() ?? null;
  const hasActiveMissedWindow =
    missedWindowStartAt != null &&
    activeMissedWindowExpiresAt != null &&
    activeMissedWindowExpiresAt > now.getTime();
  const activeMissedWindowStartAt = hasActiveMissedWindow
    ? missedWindowStartAt.getTime()
    : null;

  const missedActivities = hasActiveMissedWindow
    ? activities.filter((activity) => {
        const createdAt = getActivityTimestamp(activity).getTime();
        return (
          activeMissedWindowStartAt != null &&
          createdAt > activeMissedWindowStartAt &&
          createdAt < recentCutoff
        );
      })
    : lastVisitedAt == null
      ? []
      : activities.filter((activity) => {
          const createdAt = getActivityTimestamp(activity).getTime();
          return (
            createdAt > lastVisitedAt.getTime() && createdAt < recentCutoff
          );
        });

  const previewActivities = [...recentActivities, ...missedActivities].filter(
    (activity, index, collection) =>
      collection.findIndex((candidate) => candidate.id === activity.id) ===
      index
  );

  const limitedActivities =
    typeof limit === "number"
      ? previewActivities.slice(0, limit)
      : previewActivities;

  return {
    activities: limitedActivities,
    shouldStartMissedWindow:
      !hasActiveMissedWindow && missedActivities.length > 0,
  };
}

function getRecencyLabel(createdAt: Date) {
  const daysAgo = Math.max(0, differenceInCalendarDays(new Date(), createdAt));

  if (daysAgo === 0) return "Today's Activity";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) return `${daysAgo} Days Ago`;
  if (daysAgo < 14) return "Last week";

  const weeksAgo = Math.floor(daysAgo / 7);
  return `${weeksAgo} Weeks ago`;
}

export function ActivityFeedList({
  activities,
  groupByRecency = false,
  groupHeaderClassName,
}: ActivityFeedListProps) {
  if (groupByRecency) {
    const sortedActivities = [...activities].sort(
      (a: any, b: any) =>
        getActivityTimestamp(b).getTime() - getActivityTimestamp(a).getTime()
    );

    const groups = sortedActivities.reduce(
      (acc: Array<{ label: string; items: any[] }>, activity: any) => {
        const label = getRecencyLabel(getActivityTimestamp(activity));
        const lastGroup = acc[acc.length - 1];
        if (!lastGroup || lastGroup.label !== label) {
          acc.push({ label, items: [activity] });
        } else {
          lastGroup.items.push(activity);
        }
        return acc;
      },
      []
    );

    return (
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={`${group.label}-${group.items[0]?.id || "group"}`}>
            <StickySectionHeader className={groupHeaderClassName}>
              <h2 className="tracking-tight">{group.label}</h2>
            </StickySectionHeader>
            <div className="flex flex-col">
              {group.items.map((activity: any) => (
                <div
                  key={activity.id}
                  className="relative pb-3 last:pb-0 md:pb-4"
                >
                  <ActivityItem activity={activity} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col">
        {activities.map((activity: any) => (
          <div key={activity.id} className="relative pb-3 last:pb-0 md:pb-4">
            <ActivityItem activity={activity} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityFeed({
  limit = 50,
  hideWhenEmpty = false,
  hidePastEvents = false,
  groupByRecency = false,
  groupHeaderClassName,
  includeEventUpdates = true,
  eventTiming = "all",
}: ActivityFeedProps) {
  const { data: rawActivities, isLoading } =
    trpc.friends.getFriendFeed.useQuery({
      limit,
      includeEventUpdates,
    });

  const activities = filterActivities(rawActivities, {
    hidePastEvents,
    eventTiming,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    if (hideWhenEmpty) {
      return null;
    }
    return <EmptyStateCard icon={Users} title="No recent activity" />;
  }

  return (
    <ActivityFeedList
      activities={activities}
      groupByRecency={groupByRecency}
      groupHeaderClassName={groupHeaderClassName}
    />
  );
}

// Hook to check if there are activities (for conditionally showing sections)
export function useHasRecentActivity(
  limit: number = 50,
  hidePastEvents: boolean = false
) {
  const { data: activities, isLoading } = trpc.friends.getFriendFeed.useQuery({
    limit,
  });

  const filteredActivities = filterActivities(activities, { hidePastEvents });

  return {
    hasActivity:
      !isLoading && !!filteredActivities && filteredActivities.length > 0,
    isLoading,
  };
}

export function useHomeActivityPreview({
  limit = 3,
  hidePastEvents = true,
  includeEventUpdates = false,
  lastVisitedAt = null,
  missedWindowStartAt = null,
  missedWindowExpiresAt = null,
  staleAfterDays = 1,
}: HomeActivityPreviewOptions = {}) {
  const previewWindow = Math.min(50, Math.max(limit * 4, limit + 6));
  const { data: activities, isLoading } = trpc.friends.getFriendFeed.useQuery({
    limit: previewWindow,
    includeEventUpdates,
  });

  const preview = selectHomePreviewActivities(activities, {
    limit,
    hidePastEvents,
    lastVisitedAt,
    missedWindowStartAt,
    missedWindowExpiresAt,
    staleAfterDays,
  });

  return {
    activities: preview.activities,
    hasActivity: !isLoading && preview.activities.length > 0,
    isLoading,
    shouldStartMissedWindow: preview.shouldStartMissedWindow,
  };
}
