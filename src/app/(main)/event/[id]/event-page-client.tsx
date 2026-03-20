"use client";

import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  Calendar,
  MapPin,
  Link as LinkIcon,
  Check,
  Edit,
  Users,
  ExternalLink,
  X,
  Expand,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import { cn, splitTrailingParenthetical } from "@/lib/utils";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { useEffect, useMemo, useState } from "react";
import {
  getEventStatusBadgeClassName,
  getEventStatusLabel,
} from "@/lib/event-status";
import { SharedBackButton } from "@/components/shared/back-button";
import { buildReturnTo, withReturnTo } from "@/lib/navigation";
import { HapticPreset, useHaptics } from "@/hooks/use-haptics";
import { useAuth } from "@clerk/nextjs";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";
import { CategoryPillList } from "@/components/categories/category-pill";

type RsvpStatus = "going" | "interested" | "not_going";
type SocialAvatarUser = {
  id: string;
  avatarImageUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  rsvpStatus: "going" | "interested";
};

function EventPageSkeleton() {
  return (
    <div className="relative isolate -mt-14 min-h-screen pt-14 md:-mt-16 md:pt-16">
      <div className="absolute inset-0 -z-20 bg-background" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] overflow-hidden">
        <div className="absolute left-[-8rem] top-10 h-72 w-72 rounded-full bg-neon-pink/12 blur-3xl" />
        <div className="absolute right-[-5rem] top-16 h-80 w-80 rounded-full bg-neon-teal/12 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-full bg-gradient-to-b from-transparent via-background/30 to-background" />
        <div
          className="absolute inset-x-0 top-0 md:hidden"
          style={{ height: "160px", background: "linear-gradient(to bottom, hsl(var(--background)) 56px, transparent 160px)" }}
        />
      </div>
      <div className="container w-full px-4 pb-6 md:pt-4">
        <div className="lg:flex lg:items-start lg:gap-10">
          <div className="lg:w-[360px] lg:flex-none">
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-white/8 bg-muted/90 shadow-[0_24px_80px_rgba(0,0,0,0.18)] lg:aspect-auto lg:min-h-[360px]">
              <div className="h-full w-full animate-pulse bg-muted" />
            </div>
          </div>

          <div className="pt-4 lg:flex-1 lg:pt-0">
            <div className="space-y-3">
              <div className="h-9 w-2/3 animate-pulse rounded-full bg-muted" />
              <div className="h-5 w-1/2 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-1/3 animate-pulse rounded-full bg-muted" />
            </div>

            <div className="mt-4 flex gap-2">
              <div className="h-12 flex-1 animate-pulse rounded-full bg-muted" />
              <div className="h-12 flex-1 animate-pulse rounded-full bg-muted" />
            </div>

            <div className="mt-6 space-y-3">
              <div className="h-6 w-40 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-full animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-5/6 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-2/3 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EventPage() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isSignedIn, userId } = useAuth();
  const eventId = params.id as string;
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isShareCopied, setIsShareCopied] = useState(false);
  const returnTo = searchParams.get("returnTo");
  const editHref = withReturnTo(`/event/${eventId}/edit`, returnTo);
  const signInHref = withReturnTo(
    "/sign-in",
    buildReturnTo(pathname, searchParams)
  );
  const signUpHref = withReturnTo(
    "/sign-up",
    buildReturnTo(pathname, searchParams)
  );
  const cameFromLanding = returnTo === "/" || returnTo?.startsWith("/?");
  const unauthedRsvpHref = cameFromLanding ? signUpHref : signInHref;

  // Fetch event data
  const { data: event, isLoading } = trpc.event.getEventById.useQuery({
    eventId,
  });

  // Fetch attendees
  const { data: attendees } = trpc.event.listEventAttendees.useQuery({
    eventId,
  });
  const { data: activeCategories } = trpc.category.listActive.useQuery();
  const categoryLabelMap = useMemo(
    () =>
      Object.fromEntries(
        (activeCategories || []).map((category) => [
          category.key,
          category.label,
        ])
      ),
    [activeCategories]
  );

  // Check if user is admin
  const { data: adminCheck } = trpc.user.isAdmin.useQuery(undefined, {
    enabled: Boolean(isSignedIn),
  });
  const isAdmin = adminCheck?.isAdmin ?? false;

  // Get current user
  const { data: currentUser } = trpc.user.getCurrentUser.useQuery(undefined, {
    enabled: Boolean(isSignedIn),
  });
  const { data: myPartner } = trpc.partners.getMyPartner.useQuery(undefined, {
    enabled: Boolean(isSignedIn),
  });
  const [includePartner, setIncludePartner] = useState(false);
  const { triggerHaptic } = useHaptics();

  // RSVP mutation
  const rsvpMutation = trpc.event.setRsvpStatus.useMutation({
    onSuccess: () => {
      // toast({
      //   title: "RSVP Updated",
      //   description: "Your RSVP has been updated successfully",
      // });
      utils.event.getEventById.invalidate();
      utils.event.listEventAttendees.invalidate();
      utils.friends.getFriendFeed.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteRsvpMutation = trpc.event.deleteRsvp.useMutation({
    onSuccess: () => {
      // toast({
      //   title: "RSVP Removed",
      //   description: "Your RSVP has been removed",
      // });
      utils.event.getEventById.invalidate();
      utils.event.listEventAttendees.invalidate();
      utils.friends.getFriendFeed.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!isShareCopied) return;

    const timeoutId = window.setTimeout(() => {
      setIsShareCopied(false);
    }, 1200);

    return () => window.clearTimeout(timeoutId);
  }, [isShareCopied]);

  const hasActivePartner = myPartner?.status === "accepted";
  const isRsvpPending = rsvpMutation.isPending || deleteRsvpMutation.isPending;
  const currentRsvpStatus = event?.userRsvp?.status;
  const hasSelectableRsvp =
    currentRsvpStatus === "going" || currentRsvpStatus === "interested";
  const savedIncludePartner = useMemo(() => {
    if (
      !hasActivePartner ||
      !hasSelectableRsvp ||
      !myPartner?.partner?.id
    ) {
      return false;
    }

    const partnerId = myPartner.partner.id;
    const currentUserRsvpIncludesPartner =
      event?.userRsvp?.partnerRsvpByUserId === partnerId &&
      event.userRsvp.status === currentRsvpStatus;
    const partnerMirroredRsvpExists =
      userId != null &&
      (attendees?.some(
        (attendee) =>
          attendee.userId === partnerId &&
          attendee.partnerRsvpByUserId === userId &&
          attendee.status === currentRsvpStatus
      ) ?? false);

    return (
      currentUserRsvpIncludesPartner || partnerMirroredRsvpExists
    );
  }, [
    attendees,
    currentRsvpStatus,
    event?.userRsvp?.partnerRsvpByUserId,
    event?.userRsvp?.status,
    hasActivePartner,
    hasSelectableRsvp,
    myPartner?.partner?.id,
    userId,
  ]);

  useEffect(() => {
    setIncludePartner(savedIncludePartner);
  }, [savedIncludePartner]);

  const handleRsvp = (status: RsvpStatus) => {
    if (!isSignedIn) {
      router.push(unauthedRsvpHref);
      return;
    }

    // If clicking the same status button again, remove the RSVP
    if (event?.userRsvp?.status === status) {
      void triggerHaptic(HapticPreset.Soft);
      sendGoogleAnalyticsEvent("event_rsvp_changed", userId, {
        action: "removed",
        event_id: eventId,
        previous_status: status,
      });
      deleteRsvpMutation.mutate({ eventId });
    } else {
      void triggerHaptic(HapticPreset.Success);
      sendGoogleAnalyticsEvent("event_rsvp_changed", userId, {
        action: "set",
        event_id: eventId,
        status,
        include_partner: hasActivePartner && includePartner,
      });
      rsvpMutation.mutate({
        eventId,
        status,
        includePartner: hasActivePartner && includePartner,
      });
    }
  };

  const handlePartnerToggle = () => {
    if (currentRsvpStatus !== "going" && currentRsvpStatus !== "interested") {
      return;
    }

    const nextIncludePartner = !includePartner;
    setIncludePartner(nextIncludePartner);
    void triggerHaptic(HapticPreset.Light);
    rsvpMutation.mutate({
      eventId,
      status: currentRsvpStatus,
      includePartner: nextIncludePartner,
    });
  };

  const handleShare = async () => {
    try {
      if (!navigator.clipboard?.writeText) return;

      const eventUrl = `${window.location.origin}/event/${eventId}`;
      await navigator.clipboard.writeText(eventUrl);
      void triggerHaptic(HapticPreset.Light);
      setIsShareCopied(true);
    } catch (error) {
      console.error("Failed to copy event link:", error);
    }
  };

  if (isLoading) {
    return <EventPageSkeleton />;
  }

  if (!event) {
    return (
      <div className="container mx-auto py-12 text-center">
        <Calendar className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="mb-2 text-2xl font-bold">Event not found</h2>
        <p className="mb-4 text-muted-foreground">
          The event you&apos;re looking for doesn&apos;t exist
        </p>
        <Link href={isSignedIn ? "/home" : "/"}>
          <Button>Back to Calendar</Button>
        </Link>
      </div>
    );
  }

  const goingAttendees = attendees?.filter((a) => a.status === "going") || [];
  const interestedAttendees =
    attendees?.filter((a) => a.status === "interested") || [];
  const goingCount = goingAttendees.length;
  const interestedCount = interestedAttendees.length;
  const socialStackUsers: SocialAvatarUser[] = [
    ...goingAttendees,
    ...interestedAttendees,
  ].flatMap((attendee) => {
    if (attendee.status !== "going" && attendee.status !== "interested") {
      return [];
    }

    return [
      {
        ...attendee.user,
        rsvpStatus: attendee.status,
      },
    ];
  });
  const eventImageUrl =
    event.coverImageUrl ||
    event.venue?.logoImageUrl ||
    event.organizer?.logoImageUrl ||
    null;

  const eventDate = new Date(event.startAt);
  const formattedDate = format(eventDate, "EEE, MMM d");
  const timeWithoutTz = format(eventDate, "h:mm a");
  const daysUntilEvent = differenceInCalendarDays(
    startOfDay(eventDate),
    startOfDay(new Date())
  );
  const relativeDateLabel =
    daysUntilEvent === 1
      ? "tomorrow"
      : daysUntilEvent > 1
        ? `in ${daysUntilEvent} days`
        : daysUntilEvent <= -7 && daysUntilEvent > -14
          ? "Last Week"
        : null;
  const timezone =
    new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
      .formatToParts(eventDate)
      .find((part) => part.type === "timeZoneName")?.value || "";
  // const formattedTime = `${timeWithoutTz} ${timezone}`;
  const formattedTime = `${timeWithoutTz}`;
  const sourceLabel = event.source
    ? event.source.charAt(0).toUpperCase() + event.source.slice(1)
    : "event site";
  const isStatusFlagged = event.status !== "active";
  const isCancelledEvent = event.status === "cancelled";
  const statusLabel = getEventStatusLabel(event.status);
  const { main: titleMain, trailingParenthetical } = splitTrailingParenthetical(
    event.title
  );
  const imageOverlayButtonClassName =
    "h-11 w-11 rounded-full bg-black/55 text-white shadow-[0_10px_28px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-all hover:scale-[1.02] hover:bg-black/72 hover:text-white";

  // Check if user can edit this event
  const canEdit =
    isAdmin || (currentUser && event.createdByUserId === currentUser.id);

  return (
    <div className="relative isolate -mt-14 min-h-screen pt-14 md:-mt-16 md:pt-16">
      <div className="absolute inset-0 -z-20 bg-background" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[42rem] overflow-hidden">
        {eventImageUrl ? (
          <>
            <div className="absolute inset-x-0 top-0 h-[30rem] overflow-hidden opacity-45 blur-3xl md:inset-x-[8%] md:top-8 md:h-[28rem] md:rounded-[3rem]">
              <Image
                src={eventImageUrl}
                alt=""
                fill
                className="scale-110 object-cover"
                sizes="100vw"
                priority
              />
            </div>
            {/* <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,75,145,0.18),transparent_38%),radial-gradient(circle_at_top_right,rgba(0,229,214,0.2),transparent_34%)]" /> */}
          </>
        ) : (
          <>
            <div className="absolute left-[-8rem] top-10 h-80 w-80 rounded-full bg-neon-pink/14 blur-3xl" />
            <div className="absolute right-[-6rem] top-16 h-96 w-96 rounded-full bg-neon-teal/14 blur-3xl" />
          </>
        )}
        <div className="absolute inset-x-0 top-0 h-full bg-gradient-to-b from-background/10 via-background/35 to-background" />
        <div
          className="absolute inset-x-0 top-0 md:hidden"
          style={{ height: "160px", background: "linear-gradient(to bottom, hsl(var(--background)) 56px, transparent 160px)" }}
        />
      </div>
      {/* Image Modal */}
      {isImageModalOpen && eventImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xl"
          onClick={() => setIsImageModalOpen(false)}
        >
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-4 top-4 h-10 w-10 text-white hover:bg-white/20"
            onClick={() => setIsImageModalOpen(false)}
          >
            <X className="h-6 w-6" />
          </Button>
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={eventImageUrl}
              alt={event.title}
              width={1200}
              height={800}
              className="h-auto max-h-[90vh] w-auto max-w-[90vw] object-contain"
            />
          </div>
        </div>
      )}

      {/* Desktop two-column layout */}
      <div className="container mx-auto w-full px-4 pb-6">
        <div className="lg:flex lg:items-start lg:gap-10">
          {/* Cover Image - Left column on desktop */}
          <div className="lg:w-[420px] lg:flex-none">
            <div className="relative aspect-square w-full overflow-hidden rounded-[1.5rem] bg-muted/90 shadow-[0_28px_90px_rgba(0,0,0,0.24)] lg:aspect-auto lg:min-h-[420px]">
              {eventImageUrl && (
                <>
                  {/* <div className="absolute inset-5 -z-10 rounded-[1.75rem] bg-gradient-to-br from-neon-pink/20 via-neon-teal/12 to-transparent blur-2xl" /> */}
                  <Image
                    src={eventImageUrl}
                    alt=""
                    fill
                    className="scale-110 object-cover opacity-30 blur-3xl"
                    sizes="420px"
                    aria-hidden="true"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/24 via-transparent to-white/10" />
                </>
              )}
              {eventImageUrl ? (
                <div className="h-full w-full">
                  <Image
                    src={eventImageUrl}
                    alt={event.title}
                    fill
                    className={cn(
                      "object-cover",
                      isStatusFlagged && "opacity-50 blur-[2px]"
                    )}
                    sizes="420px"
                    priority
                  />
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                  <Calendar className="h-24 w-24 text-muted-foreground/40" />
                </div>
              )}
              {eventImageUrl && isStatusFlagged && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="rounded-md bg-card px-2 py-1 text-base font-semibold uppercase tracking-[0.12em] text-white">
                    {statusLabel}
                  </span>
                </div>
              )}

              {/* Back Button - Overlay on top left */}
              <SharedBackButton
                fallbackHref={isSignedIn ? "/home" : "/"}
                returnTo={returnTo}
                variant="ghost"
                size="icon"
                className={cn(
                  "absolute left-2.5 top-2.5",
                  imageOverlayButtonClassName
                )}
                iconClassName="h-[18px] w-[18px]"
              />

              {/* Action Icons - Overlay on top right */}
              <div className="absolute right-2.5 top-2.5 flex gap-2">
                {canEdit && (
                  <Link href={editHref}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={imageOverlayButtonClassName}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  </Link>
                )}
                {/*<Button size="icon" variant="secondary" className="h-10 w-10">*/}
                {/*  <Heart className="h-4 w-4" />*/}
                {/*</Button>*/}
                <Button
                  size="icon"
                  variant="ghost"
                  className={imageOverlayButtonClassName}
                  onClick={() => void handleShare()}
                  aria-label={isShareCopied ? "Link copied" : "Copy event link"}
                >
                  {isShareCopied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <LinkIcon className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {/* Avatars - Overlay on bottom right */}
              {socialStackUsers.length > 0 && (
                <div className="absolute bottom-2.5 right-2.5">
                  <AvatarStack
                    users={socialStackUsers}
                    maxDisplay={5}
                    size="xl"
                  />
                </div>
              )}

              {/* Expand Button - bottom left */}
              {eventImageUrl && (
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "absolute bottom-2.5 left-2.5",
                    imageOverlayButtonClassName
                  )}
                  onClick={() => setIsImageModalOpen(true)}
                >
                  <Expand className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="lg:flex-1 lg:pt-14">
            <div className="pt-4">
              <h1 className="font-space-grotesk text-3xl/8 font-bold md:text-6xl">
                {titleMain}
                {trailingParenthetical ? (
                  <span className="whitespace-nowrap">
                    {" "}
                    {trailingParenthetical}
                  </span>
                ) : null}
              </h1>
            </div>

            <div
              className={cn(
                "flex items-center gap-2 pt-1.5 text-lg text-neon-teal md:text-2xl",
                isStatusFlagged && "text-muted-foreground line-through"
              )}
            >
              {/*<Calendar className="h-4 w-4" />*/}
              <span>
                <span className={"font-space-grotesk font-medium"}>
                  {formattedDate} at {formattedTime}
                </span>
                {relativeDateLabel ? (
                  <span className="ml-2 text-sm text-muted-foreground">
                    ({relativeDateLabel})
                  </span>
                ) : null}
              </span>
            </div>

            {(event.venue?.name || (event.categories?.length ?? 0) > 0) && (
              <div className="flex flex-wrap items-center gap-2 pt-0.5 md:pt-1">
                {event.venue?.name && (
                  <Link
                    className="font-space-grotesk flex w-fit items-center gap-2 text-lg font-medium transition-colors hover:underline md:text-2xl"
                    href={`/venue/${event.venue?.slug}`}
                  >
                    <span>{event.venue.name}</span>
                  </Link>
                )}
                <CategoryPillList
                  categories={event.categories || []}
                  categoryLabelMap={categoryLabelMap}
                  variant={"small"}
                />
              </div>
            )}

            {event.organizer && (
              <div className="font-space-grotesk flex w-fit items-center gap-1 pt-0.5 text-base text-muted-foreground md:pt-1 md:text-xl">
                <span>Organized by </span>
                <Link
                  href={`/organizer/${event.organizer.slug}`}
                  className="flex items-center gap-2 transition-colors hover:underline"
                >
                  {event.organizer.name}
                </Link>
              </div>
            )}

            {event.eventUrl && (
              <a
                href={event.eventUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-space-grotesk flex w-fit items-center gap-2 pt-0.5 text-muted-foreground transition-colors hover:underline md:pt-1 md:text-xl"
              >
                <span>View on {sourceLabel}</span>
                <ExternalLink className="h-4 w-4" />
              </a>
            )}

            {!isCancelledEvent && (
              <>
                {/* RSVP Buttons - Shared across mobile and desktop */}
                <div className="flex gap-2 pb-2 pt-4">
                  <Button
                    variant="neon"
                    className={cn(
                      "font-space-grotesk flex-1 rounded-xl py-5 text-base font-medium lg:text-lg",
                      event.userRsvp?.status === "interested" &&
                        "border-transparent bg-neon-teal text-black hover:bg-neon-teal-hover hover:text-black active:text-black"
                    )}
                    size="lg"
                    onClick={() => handleRsvp("interested")}
                    disabled={isRsvpPending}
                  >
                    Interested
                  </Button>
                  <Button
                    variant="neon"
                    className={cn(
                      "font-space-grotesk flex-1 rounded-xl py-5 text-base font-medium lg:text-lg",
                      event.userRsvp?.status === "going" &&
                        "border-transparent bg-neon-teal text-black hover:bg-neon-teal-hover hover:text-black active:text-black"
                    )}
                    size="lg"
                    onClick={() => handleRsvp("going")}
                    disabled={isRsvpPending}
                  >
                    Going
                  </Button>
                </div>

                {hasActivePartner && hasSelectableRsvp && (
                  <div className="mb-4">
                    <Button
                      type="button"
                      variant="neon"
                      className={cn(
                        "font-space-grotesk w-full rounded-xl text-base font-medium sm:w-auto sm:min-w-[220px]",
                        includePartner &&
                          "border-transparent bg-neon-teal text-black hover:bg-neon-teal-hover hover:text-black active:text-black"
                      )}
                      onClick={handlePartnerToggle}
                      disabled={isRsvpPending}
                      aria-pressed={includePartner}
                    >
                      With {myPartner.partner.firstName}
                      {includePartner ? "" : "?"}
                    </Button>
                  </div>
                )}
              </>
            )}

            {/*<Separator />*/}

            {/* About Section */}
            <div className={"pt-4"}>
              <h2 className="font-space-grotesk mb-2 text-2xl font-bold">
                About
              </h2>

              {/* Event Date */}
              <div className="mb-6">
                <p className="text-muted-foreground">{event.title}</p>
              </div>

              {/* Description */}
              {event.description && (
                <div className="mb-6">
                  <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                    {event.description}
                  </p>
                </div>
              )}

              {/* Location Details */}
              <div className="space-y-2">
                {event.address && (
                  <p className="text-muted-foreground">{event.address}</p>
                )}
                <p className="text-muted-foreground">
                  {event.city}, {event.state}
                </p>
              </div>
            </div>

            {/* Lineup / Attendees Section */}
            {goingCount > 0 && (
              <div className={"pt-4"}>
                <h2 className="font-space-grotesk mb-4 text-2xl font-bold">
                  Who&apos;s Going
                </h2>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  {goingAttendees.slice(0, 9).map((attendee) => (
                    <div
                      key={attendee.user.id}
                      className="flex items-center gap-3 rounded-lg border bg-card p-3"
                    >
                      <div className="rounded-full bg-neon-teal p-px">
                        <UserAvatar
                          src={attendee.user.avatarImageUrl}
                          name={attendee.user.firstName}
                          className="h-10 w-10"
                        />
                      </div>
                      <div className="text-sm">
                        <p className="font-medium">
                          {attendee.user.firstName} {attendee.user.lastName}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                {goingCount > 9 && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    And {goingCount - 9} others are going
                  </p>
                )}
              </div>
            )}

            {interestedCount > 0 && (
              <div className={"pt-4"}>
                <h2 className="font-space-grotesk mb-4 text-2xl font-bold">
                  Who&apos;s Interested
                </h2>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  {interestedAttendees.slice(0, 9).map((attendee) => (
                    <div
                      key={attendee.user.id}
                      className="flex items-center gap-3 rounded-lg border bg-card p-3"
                    >
                      <div className="rounded-full bg-yellow-400 p-px">
                        <UserAvatar
                          src={attendee.user.avatarImageUrl}
                          name={attendee.user.firstName}
                          className="h-10 w-10"
                        />
                      </div>
                      <div className="text-sm">
                        <p className="font-medium">
                          {attendee.user.firstName} {attendee.user.lastName}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                {interestedCount > 9 && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    And {interestedCount - 9} others are interested
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
