"use client";

import { trpc } from "@/lib/trpc";
import { UserAvatar } from "@/components/ui/user-avatar";
import Image from "next/image";
import { useEffect } from "react";
import {
  Loader2,
  Users,
  Check,
  Star,
  Building2,
  CalendarPlus,
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
} from "date-fns";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatRelativeEventDate } from "@/lib/utils";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { buildReturnTo, withReturnTo } from "@/lib/navigation";
import { EmptyStateCard } from "@/components/shared/empty-state-card";

interface ActivityItemProps {
  activity: any;
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
  const { actor, type, entityId, metadata, createdAt, event } = activity;
  const place = activity.place;
  const isEventStatusUpdate = EVENT_UPDATE_TYPES.has(type);
  const returnTo = buildReturnTo(pathname, searchParams);
  const eventHref = withReturnTo(`/event/${entityId}`, returnTo);
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
        : `on ${format(eventDate, "MMMM do")}`
    : null;

  if (isEventStatusUpdate) {
    return null;
  }

  const renderIcon = () => {
    switch (type) {
      case "rsvp_going":
        return <Check className="h-4 w-4 text-green-500" />;
      case "rsvp_interested":
        return <Star className="h-4 w-4 text-yellow-500" />;
      case "rsvp_not_going":
        return <X className="h-4 w-4 text-red-500" />;
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
    const actorName = (
      <span className="font-medium text-foreground">
        {actor.firstName} {actor.lastName}
      </span>
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
          className="font-medium text-primary hover:underline"
        >
          {entityName}
        </Link>
      </>
    ) : (
      <span className="font-medium text-foreground">{entityName}</span>
    );

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
            {subjectName} {isPluralSubject ? "are" : "is"} no longer going to{" "}
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
            <Link href={eventHref} className="font-medium text-primary hover:underline">
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
            {cancelledEventDatePhrase ? ` ${cancelledEventDatePhrase}` : ""}{" "}
            has been cancelled
          </>
        );
      case "postponed":
        return (
          <>
            <Link href={eventHref} className="font-medium text-primary hover:underline">
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
            <Link href={eventHref} className="font-medium text-primary hover:underline">
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
            <Link href={eventHref} className="font-medium text-primary hover:underline">
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
            <Link href={eventHref} className="font-medium text-primary hover:underline">
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
    <div className="flex gap-4 pb-2 last:pb-0">
      <div className="relative flex flex-col items-center pt-1.5">
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
              ? "h-10 w-10 rounded-md border-2 border-background ring-2 ring-muted/20"
              : "h-10 w-10 rounded-full border-2 border-background ring-2 ring-muted/20"
          }
        />
        <div className="absolute -right-[6px] -top-[0.5px] rounded-full bg-card p-0.5">
          {renderIcon()}
        </div>
      </div>
      <div className="flex-1">
        <p className="text-base text-muted-foreground">
          {content}
          {!isEventStatusUpdate && eventRelativeDate && (
            <span className="ml-1.5 font-medium text-muted-foreground">
              {eventRelativeDate}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground/60 md:text-sm">
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
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

export function ActivityFeed({
  limit = 50,
  hideWhenEmpty = false,
  hidePastEvents = false,
  groupByRecency = false,
  groupHeaderClassName,
}: ActivityFeedProps) {
  const { data: rawActivities, isLoading } =
    trpc.friends.getFriendFeed.useQuery({
      limit,
    });

  const visibleActivities = rawActivities?.filter(
    (activity: any) =>
      !EVENT_UPDATE_TYPES.has(activity.type) &&
      !HIDDEN_ACTIVITY_TYPES.has(activity.type)
  );

  const activities = hidePastEvents
    ? visibleActivities?.filter((activity: any) => {
        if (!activity.event?.startAt) return true;
        const eventDate = startOfDay(new Date(activity.event.startAt));
        const today = startOfDay(new Date());
        return eventDate >= today;
      })
    : visibleActivities;

  useEffect(() => {
    if (limit !== 3 || !hidePastEvents) return;

    console.log("[Recent Activity][/home] rawActivities", rawActivities);
    console.log("[Recent Activity][/home] visibleActivities", visibleActivities);
    console.log("[Recent Activity][/home] finalActivities", activities);
  }, [activities, hidePastEvents, limit, rawActivities, visibleActivities]);

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

  if (groupByRecency) {
    const sortedActivities = [...activities].sort(
      (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const groups = sortedActivities.reduce(
      (acc: Array<{ label: string; items: any[] }>, activity: any) => {
        const label = getRecencyLabel(new Date(activity.createdAt));
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
              <h2 className="text-xl font-semibold tracking-tight">
                {group.label}
              </h2>
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

// Hook to check if there are activities (for conditionally showing sections)
export function useHasRecentActivity(
  limit: number = 50,
  hidePastEvents: boolean = false
) {
  const { data: activities, isLoading } = trpc.friends.getFriendFeed.useQuery({
    limit,
  });

  const visibleActivities = activities?.filter(
    (activity: any) =>
      !EVENT_UPDATE_TYPES.has(activity.type) &&
      !HIDDEN_ACTIVITY_TYPES.has(activity.type)
  );

  const filteredActivities = hidePastEvents
    ? visibleActivities?.filter((activity: any) => {
        if (!activity.event?.startAt) return true;
        const eventDate = startOfDay(new Date(activity.event.startAt));
        const today = startOfDay(new Date());
        return eventDate >= today;
      })
    : visibleActivities;

  return {
    hasActivity:
      !isLoading && !!filteredActivities && filteredActivities.length > 0,
    isLoading,
  };
}
