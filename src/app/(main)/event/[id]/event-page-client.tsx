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
  Link as LinkIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit,
  ExternalLink,
  X,
  Expand,
  Star,
  Briefcase,
  Plane,
  Moon,
  CircleMinus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import {
  cn,
  formatEventDate,
  formatEventTime,
  splitTrailingParenthetical,
} from "@/lib/utils";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { useEffect, useMemo, useState } from "react";
import { getEventStatusLabel } from "@/lib/event-status";
import { withImageVersion } from "@/components/events/event-card-helpers";
import { SharedBackButton } from "@/components/shared/back-button";
import { buildReturnTo, withReturnTo } from "@/lib/navigation";
import { HapticPreset, useHaptics } from "@/hooks/use-haptics";
import { useAuth } from "@clerk/nextjs";
import { sendGoogleAnalyticsEvent } from "@/lib/google-analytics";
import { CategoryPillList } from "@/components/categories/category-pill";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  RSVP_DECLINE_REASON_LABELS,
  RSVP_DECLINE_REASON_VALUES,
  type RsvpDeclineReason,
} from "@/lib/rsvp";
import { useMediaQuery } from "@/hooks/use-media-query";

type RsvpStatus = "going" | "interested" | "not_going";
type RsvpDialogScreen = "main" | "cant_go" | "more";
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
      <div className="container w-full px-4 pb-6 md:pt-4">
        <div className="lg:flex lg:items-start lg:gap-10">
          <div className="lg:w-[360px] lg:flex-none">
            <div className="border-white/8 relative aspect-square w-full overflow-hidden rounded-2xl border bg-muted/90 shadow-[0_24px_80px_rgba(0,0,0,0.18)] lg:aspect-auto lg:min-h-[360px]">
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
  const [isRsvpDialogOpen, setIsRsvpDialogOpen] = useState(false);
  const [rsvpDialogScreen, setRsvpDialogScreen] =
    useState<RsvpDialogScreen>("main");
  const [cantGoReason, setCantGoReason] = useState<RsvpDeclineReason | null>(
    null
  );
  const [cantGoIncludePartner, setCantGoIncludePartner] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

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
  const currentNotGoingReason =
    currentRsvpStatus === "not_going"
      ? (event?.userRsvp?.notGoingReason ?? null)
      : null;
  const hasSelectableRsvp =
    currentRsvpStatus === "going" || currentRsvpStatus === "interested";
  const savedIncludePartner = useMemo(() => {
    if (!hasActivePartner || !hasSelectableRsvp || !myPartner?.partner?.id) {
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
      ) ??
        false);

    return currentUserRsvpIncludesPartner || partnerMirroredRsvpExists;
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
  const savedCantGoIncludePartner = useMemo(() => {
    if (
      !hasActivePartner ||
      currentRsvpStatus !== "not_going" ||
      !myPartner?.partner?.id ||
      userId == null
    ) {
      return false;
    }

    const partnerId = myPartner.partner.id;
    return (
      attendees?.some(
        (attendee) =>
          attendee.userId === partnerId &&
          attendee.partnerRsvpByUserId === userId &&
          attendee.status === "not_going"
      ) ?? false
    );
  }, [
    attendees,
    currentRsvpStatus,
    hasActivePartner,
    myPartner?.partner?.id,
    userId,
  ]);

  useEffect(() => {
    setIncludePartner(
      hasActivePartner
        ? hasSelectableRsvp
          ? savedIncludePartner
          : true
        : false
    );
  }, [hasActivePartner, hasSelectableRsvp, savedIncludePartner]);

  useEffect(() => {
    setCantGoReason(currentNotGoingReason ?? null);
  }, [currentNotGoingReason]);

  useEffect(() => {
    setCantGoIncludePartner(
      hasActivePartner
        ? currentRsvpStatus === "not_going"
          ? savedCantGoIncludePartner
          : true
        : false
    );
  }, [currentRsvpStatus, hasActivePartner, savedCantGoIncludePartner]);

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

  const handleCantGo = () => {
    if (!isSignedIn) {
      router.push(unauthedRsvpHref);
      return;
    }

    void triggerHaptic(HapticPreset.Light);
    setCantGoReason(currentNotGoingReason ?? null);
    setCantGoIncludePartner(
      hasActivePartner
        ? currentRsvpStatus === "not_going"
          ? savedCantGoIncludePartner
          : true
        : false
    );
    setRsvpDialogScreen("cant_go");
    setIsRsvpDialogOpen(true);
  };

  const openRsvpDialog = () => {
    if (!isSignedIn) {
      router.push(unauthedRsvpHref);
      return;
    }

    void triggerHaptic(HapticPreset.Light);
    setRsvpDialogScreen("main");
    setCantGoReason(currentNotGoingReason ?? null);
    setCantGoIncludePartner(
      hasActivePartner
        ? currentRsvpStatus === "not_going"
          ? savedCantGoIncludePartner
          : true
        : false
    );
    setIsRsvpDialogOpen(true);
  };

  const chooseRsvpStatus = (status: Extract<RsvpStatus, "going" | "interested">) => {
    if (currentRsvpStatus === status) {
      setIsRsvpDialogOpen(false);
      return;
    }

    handleRsvp(status);
    setIsRsvpDialogOpen(false);
  };

  const submitCantGo = (reason: RsvpDeclineReason | null) => {
    if (!isSignedIn) {
      router.push(unauthedRsvpHref);
      return;
    }

    void triggerHaptic(HapticPreset.Warning);
    sendGoogleAnalyticsEvent("event_rsvp_changed", userId, {
      action: "set",
      event_id: eventId,
      status: "not_going",
      include_partner: hasActivePartner && cantGoIncludePartner,
      reason: reason ?? undefined,
    });
    setIsRsvpDialogOpen(false);
    rsvpMutation.mutate({
      eventId,
      status: "not_going",
      includePartner: hasActivePartner && cantGoIncludePartner,
      reason,
    });
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
  const notGoingAttendees =
    attendees?.filter((a) => a.status === "not_going") || [];
  const goingCount = goingAttendees.length;
  const interestedCount = interestedAttendees.length;
  const notGoingCount = notGoingAttendees.length;
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
    withImageVersion(event.coverImageUrl, event.updatedAt) ||
    event.venue?.logoImageUrl ||
    event.organizer?.logoImageUrl ||
    null;

  const eventDate = new Date(event.startAt);
  const formattedDate = formatEventDate(
    event.startAt,
    event.timeZone,
    event.state
  );
  const timeWithoutTz = formatEventTime(
    event.startAt,
    event.timeZone,
    event.state
  );
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
  const isStatusFlagged = event.status !== "active";
  const isCancelledEvent = event.status === "cancelled";
  const statusLabel = getEventStatusLabel(event.status);
  const { main: titleMain, trailingParenthetical } = splitTrailingParenthetical(
    event.title
  );
  const imageOverlayButtonClassName =
    "h-11 w-11 rounded-full bg-black/55 text-white shadow-[0_10px_28px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-all hover:scale-[1.02] hover:bg-black/72 hover:text-white";
  const shouldShowAttendeeIdentities = Boolean(isSignedIn);
  const renderAttendeeCard = (attendee: (typeof goingAttendees)[number]) => {
    const attendeeName =
      [attendee.user.firstName, attendee.user.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      attendee.user.username ||
      "Someone";
    const content = (
      <>
        <div className="rounded-full p-px">
          <UserAvatar
            src={attendee.user.avatarImageUrl}
            name={attendee.user.firstName}
            className="h-10 w-10"
          />
        </div>
        <div className="min-w-0 text-sm">
          <p className="truncate font-medium">{attendeeName}</p>
        </div>
      </>
    );

    if (attendee.user.username) {
      return (
        <Link
          key={attendee.user.id}
          href={`/${attendee.user.username}`}
          className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40"
        >
          {content}
        </Link>
      );
    }

    return (
      <div
        key={attendee.user.id}
        className="flex items-center gap-3 rounded-lg border bg-card p-3"
      >
        {content}
      </div>
    );
  };

  // Check if user can edit this event
  const canEdit =
    isAdmin || (currentUser && event.createdByUserId === currentUser.id);
  const rsvpButtonLabel =
    currentRsvpStatus === "going"
      ? "Going"
      : currentRsvpStatus === "interested"
        ? "Interested"
        : currentRsvpStatus === "not_going"
          ? "Can't Go"
          : "RSVP";
  const declineReasonIcons: Record<
    RsvpDeclineReason,
    typeof Calendar
  > = {
    busy: Calendar,
    out_of_town: Plane,
    working: Briefcase,
    laying_low: Moon,
  };
  const rsvpDialogBackButton =
    rsvpDialogScreen === "main" ? null : (
      <button
        type="button"
        className="flex items-center gap-3 rounded-2xl px-1 py-2 text-lg font-semibold text-white/90 transition-colors hover:text-white"
        onClick={() => setRsvpDialogScreen("main")}
      >
        <ChevronLeft className="h-5 w-5" />
        Back
      </button>
    );
  const rsvpMainContent = (
    <div className="space-y-2">
      <button
        type="button"
        className="flex w-full items-center gap-5 rounded-2xl px-2 py-5 text-left text-xl font-semibold text-white transition-colors hover:bg-white/[0.08]"
        onClick={() => chooseRsvpStatus("going")}
        disabled={isRsvpPending}
      >
        <Check className="h-7 w-7 text-neon-teal" />
        <span className="flex-1">Going</span>
        {currentRsvpStatus === "going" ? (
          <Check className="h-5 w-5 text-neon-teal" />
        ) : null}
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-5 rounded-2xl px-2 py-5 text-left text-xl font-semibold text-white transition-colors hover:bg-white/[0.08]"
        onClick={() => chooseRsvpStatus("interested")}
        disabled={isRsvpPending}
      >
        <Star className="h-7 w-7 fill-yellow-300 text-yellow-300" />
        <span className="flex-1">Interested</span>
        {currentRsvpStatus === "interested" ? (
          <Check className="h-5 w-5 text-neon-teal" />
        ) : null}
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-5 rounded-2xl px-2 py-5 text-left text-xl font-semibold text-white transition-colors hover:bg-white/[0.08]"
        onClick={handleCantGo}
        disabled={isRsvpPending}
      >
        <X className="h-7 w-7 text-red-400" />
        <span className="flex-1">Can&apos;t Go</span>
        <ChevronRight className="h-5 w-5 text-white/60" />
      </button>
      <div className="mx-2 border-t border-white/12" />
      <button
        type="button"
        className="flex w-full items-center gap-5 rounded-2xl px-2 py-5 text-left text-xl font-semibold text-white transition-colors hover:bg-white/[0.08]"
        onClick={() => setRsvpDialogScreen("more")}
      >
        <span className="h-7 w-7" />
        <span className="flex-1">More</span>
        <ChevronRight className="h-5 w-5 text-white/60" />
      </button>
    </div>
  );
  const rsvpCantGoContent = (
    <div className="space-y-2">
      {rsvpDialogBackButton}
      <div className="mx-2 border-t border-white/12" />
      {RSVP_DECLINE_REASON_VALUES.map((reason) => {
        const ReasonIcon = declineReasonIcons[reason];

        return (
          <button
            key={reason}
            type="button"
            className="flex w-full items-center gap-5 rounded-2xl px-2 py-5 text-left text-xl font-semibold text-white transition-colors hover:bg-white/[0.08]"
            onClick={() => {
              setCantGoReason(reason);
              submitCantGo(reason);
            }}
            disabled={isRsvpPending}
          >
            <ReasonIcon className="h-7 w-7 text-white/90" />
            <span className="flex-1">
              {RSVP_DECLINE_REASON_LABELS[reason]}
            </span>
            {currentNotGoingReason === reason ? (
              <Check className="h-5 w-5 text-neon-teal" />
            ) : null}
          </button>
        );
      })}
      <button
        type="button"
        className="flex w-full items-center gap-5 rounded-2xl px-2 py-5 text-left text-xl font-semibold text-white transition-colors hover:bg-white/[0.08]"
        onClick={() => submitCantGo(null)}
        disabled={isRsvpPending}
      >
        <CircleMinus className="h-7 w-7 text-white/70" />
        <span className="flex-1">No reason</span>
        {currentRsvpStatus === "not_going" && !currentNotGoingReason ? (
          <Check className="h-5 w-5 text-neon-teal" />
        ) : null}
      </button>
    </div>
  );
  const rsvpMoreContent = (
    <div className="space-y-2">
      {rsvpDialogBackButton}
      <div className="mx-2 border-t border-white/12" />
      {hasActivePartner && myPartner?.partner?.firstName ? (
        <div className="flex items-center justify-between gap-5 rounded-2xl px-2 py-5 text-xl font-semibold text-white">
          <span className="min-w-0 flex-1">
            RSVP with {myPartner.partner.firstName}
          </span>
          <Switch
            checked={
              currentRsvpStatus === "not_going"
                ? cantGoIncludePartner
                : includePartner
            }
            disabled={isRsvpPending}
            onCheckedChange={(checked) => {
              if (currentRsvpStatus === "not_going") {
                setCantGoIncludePartner(checked);
                rsvpMutation.mutate({
                  eventId,
                  status: "not_going",
                  includePartner: checked,
                  reason: currentNotGoingReason,
                });
                return;
              }

              if (
                currentRsvpStatus === "going" ||
                currentRsvpStatus === "interested"
              ) {
                handlePartnerToggle();
                return;
              }

              setIncludePartner(checked);
            }}
            className="bg-white/20 data-[state=checked]:bg-neon-teal"
          />
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-5 rounded-2xl px-2 py-5 text-xl font-semibold text-white">
        <span className="min-w-0 flex-1">Notify Friends</span>
        <Switch
          checked
          disabled
          className="bg-white/20 data-[state=checked]:bg-neon-teal"
        />
      </div>
    </div>
  );
  const rsvpDialogContent =
    rsvpDialogScreen === "cant_go"
      ? rsvpCantGoContent
      : rsvpDialogScreen === "more"
        ? rsvpMoreContent
        : rsvpMainContent;

  return (
    <div className="relative isolate -mt-14 min-h-screen pt-14 md:-mt-16 md:pt-16">
      <div className="absolute inset-0 -z-20 bg-background" />
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

      {isDesktop ? (
        <Dialog open={isRsvpDialogOpen} onOpenChange={setIsRsvpDialogOpen}>
          <DialogContent className="max-w-xl rounded-[2rem] border border-white/10 bg-[#202023]/95 p-7 text-white shadow-[0_28px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:rounded-[2rem]">
            <DialogHeader className="sr-only">
              <DialogTitle>RSVP</DialogTitle>
            </DialogHeader>
            {rsvpDialogContent}
          </DialogContent>
        </Dialog>
      ) : (
        <Sheet open={isRsvpDialogOpen} onOpenChange={setIsRsvpDialogOpen}>
          <SheetContent
            side="bottom"
            className="rounded-t-[2rem] border-white/10 bg-[#202023]/95 px-7 pb-7 pt-6 text-white shadow-[0_-20px_80px_rgba(0,0,0,0.55)] outline-none backdrop-blur-xl"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>RSVP</SheetTitle>
            </SheetHeader>
            {rsvpDialogContent}
          </SheetContent>
        </Sheet>
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
                  <div className="from-black/24 absolute inset-0 bg-gradient-to-t via-transparent to-white/10" />
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
                onClick={() => {
                  void triggerHaptic(HapticPreset.Light);
                }}
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
                {event.eventUrl && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className={imageOverlayButtonClassName}
                    asChild
                  >
                    <a
                      href={event.eventUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open event website"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
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
              {shouldShowAttendeeIdentities && socialStackUsers.length > 0 && (
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
                  onClick={() => {
                    void triggerHaptic(HapticPreset.Light);
                    setIsImageModalOpen(true);
                  }}
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

            {!isCancelledEvent && (
              <div className="pb-2 pt-4">
                <Button
                  variant="neon"
                  className={cn(
                    "font-space-grotesk h-14 w-full rounded-xl px-4 text-base font-semibold lg:text-lg",
                    currentRsvpStatus &&
                      "border-transparent bg-neon-teal text-black hover:bg-neon-teal-hover hover:text-black active:text-black"
                  )}
                  size="lg"
                  onClick={openRsvpDialog}
                  disabled={isRsvpPending}
                >
                  {rsvpButtonLabel}
                  <ChevronRight className="ml-2 h-4 w-4 rotate-90" />
                </Button>
              </div>
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
            {shouldShowAttendeeIdentities && goingCount > 0 && (
              <div className={"pt-4"}>
                <h2 className="font-space-grotesk mb-4 text-2xl font-bold">
                  Who&apos;s Going
                </h2>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  {goingAttendees.slice(0, 9).map(renderAttendeeCard)}
                </div>
                {goingCount > 9 && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    And {goingCount - 9} others are going
                  </p>
                )}
              </div>
            )}

            {shouldShowAttendeeIdentities && interestedCount > 0 && (
              <div className={"pt-4"}>
                <h2 className="font-space-grotesk mb-4 text-2xl font-bold">
                  Who&apos;s Interested
                </h2>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  {interestedAttendees.slice(0, 9).map(renderAttendeeCard)}
                </div>
                {interestedCount > 9 && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    And {interestedCount - 9} others are interested
                  </p>
                )}
              </div>
            )}

            {shouldShowAttendeeIdentities && notGoingCount > 0 && (
              <div className={"pt-4"}>
                <h2 className="font-space-grotesk mb-4 text-2xl font-bold">
                  Can&apos;t Go
                </h2>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  {notGoingAttendees.slice(0, 9).map(renderAttendeeCard)}
                </div>
                {notGoingCount > 9 && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    And {notGoingCount - 9} others can&apos;t go
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
