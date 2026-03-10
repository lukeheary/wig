"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Switch } from "@/components/ui/switch";
import {
  Calendar,
  MapPin,
  Share,
  Check,
  Edit,
  Users,
  ExternalLink,
  X,
  Expand,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
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

type RsvpStatus = "going" | "interested" | "not_going";

function EventPageSkeleton() {
  return (
    <div className="relative isolate -mt-16 min-h-screen bg-background pt-16">
      <div className="container w-full px-4 pb-8 md:pt-4">
        <div className="lg:flex lg:items-start lg:gap-10">
          <div className="lg:w-[360px] lg:flex-none">
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-muted lg:aspect-auto lg:min-h-[360px]">
              <div className="h-full w-full animate-pulse bg-muted" />
            </div>
          </div>

          <div className="pt-6 lg:flex-1 lg:pt-0">
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
  const { isSignedIn } = useAuth();
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
  const [includePartner, setIncludePartner] = useState(true);
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
    setIncludePartner(true);
  }, [eventId, myPartner?.partner?.id, myPartner?.status]);

  useEffect(() => {
    if (!isShareCopied) return;

    const timeoutId = window.setTimeout(() => {
      setIsShareCopied(false);
    }, 1200);

    return () => window.clearTimeout(timeoutId);
  }, [isShareCopied]);

  const hasActivePartner = myPartner?.status === "accepted";
  const goingLabel =
    hasActivePartner && includePartner ? "We're Going" : "I'm Going";
  const interestedLabel =
    hasActivePartner && includePartner ? "We're Interested" : "I'm Interested";

  const handleRsvp = (status: RsvpStatus) => {
    if (!isSignedIn) {
      router.push(unauthedRsvpHref);
      return;
    }

    // If clicking the same status button again, remove the RSVP
    if (event?.userRsvp?.status === status) {
      void triggerHaptic(HapticPreset.Soft);
      deleteRsvpMutation.mutate({ eventId });
    } else {
      void triggerHaptic(HapticPreset.Success);
      rsvpMutation.mutate({
        eventId,
        status,
        includePartner: hasActivePartner && includePartner,
      });
    }
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

  const goingCount = attendees?.filter((a) => a.status === "going").length || 0;
  // Get users who are going for avatar stack
  const goingUsers =
    attendees?.filter((a) => a.status === "going").map((a) => a.user) || [];
  const eventImageUrl =
    event.coverImageUrl ||
    event.venue?.logoImageUrl ||
    event.organizer?.logoImageUrl ||
    null;

  const eventDate = new Date(event.startAt);
  const formattedDate = format(eventDate, "EEE, MMM d");
  const timeWithoutTz = format(eventDate, "h:mm a");
  const timezone =
    new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
      .formatToParts(eventDate)
      .find((part) => part.type === "timeZoneName")?.value || "";
  // const formattedTime = `${timeWithoutTz} ${timezone}`;
  const formattedTime = `${timeWithoutTz}`;
  const sourceLabel = event.source
    ? event.source.charAt(0).toUpperCase() + event.source.slice(1)
    : "Event Site";
  const isStatusFlagged = event.status !== "active";
  const isCancelledEvent = event.status === "cancelled";
  const statusLabel = getEventStatusLabel(event.status);

  // Check if user can edit this event
  const canEdit =
    isAdmin || (currentUser && event.createdByUserId === currentUser.id);

  return (
    <div className="relative isolate -mt-16 min-h-screen bg-background pt-16">
      {eventImageUrl && (
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <Image
            src={eventImageUrl}
            alt=""
            fill
            className="scale-110 object-cover opacity-20 blur-2xl"
            sizes="100vw"
            priority
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,hsl(var(--background))_0%,hsl(var(--background))_10%,hsl(var(--background)/0.85)_40%,hsl(var(--background)/0.3)_70%,hsl(var(--background)/0)_100%)] md:bg-gradient-to-b md:from-background/60 md:via-background/60 md:to-background" />
        </div>
      )}
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
      <div className="container mx-auto w-full px-4 pb-8">
        <div className="lg:flex lg:items-start lg:gap-10">
          {/* Cover Image - Left column on desktop */}
          <div className="lg:w-[360px] lg:flex-none">
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-muted lg:aspect-auto lg:min-h-[360px]">
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
                    sizes="360px"
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
                variant="secondary"
                size="icon"
                className="absolute left-4 top-4 h-10 w-10"
                iconClassName="h-4 w-4"
              />

              {/* Action Icons - Overlay on top right */}
              <div className="absolute right-4 top-4 flex gap-2">
                {canEdit && (
                  <Link href={editHref}>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-10 w-10"
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
                  variant="secondary"
                  className="h-10 w-10"
                  onClick={() => void handleShare()}
                  aria-label={isShareCopied ? "Link copied" : "Copy event link"}
                >
                  {isShareCopied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Share className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {/* Avatars - Overlay on bottom right */}
              {goingUsers.length > 0 && (
                <div className="absolute bottom-4 right-4">
                  <AvatarStack users={goingUsers} maxDisplay={5} size="md" />
                </div>
              )}

              {/* Expand Button - bottom left */}
              {eventImageUrl && (
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute bottom-4 left-4 h-10 w-10"
                  onClick={() => setIsImageModalOpen(true)}
                >
                  <Expand className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Content - Right column on desktop */}
          <div className="pt-6 lg:flex-1 lg:pt-0">
            <div className="mb-2">
              <h1 className="text-3xl font-bold md:text-4xl">{event.title}</h1>
            </div>

            {event.venue?.name && (
              <Link
                className="mt-1 flex w-fit items-center gap-2 text-lg transition-colors hover:underline"
                href={`/venue/${event.venue?.slug}`}
              >
                <MapPin className="h-4 w-4" />
                <span className="">{event.venue.name}</span>
              </Link>
            )}

            <div
              className={cn(
                "mt-1 flex items-center gap-2 text-lg",
                isStatusFlagged && "text-muted-foreground line-through"
              )}
            >
              <Calendar className="h-4 w-4" />
              <span>
                {formattedDate} at {formattedTime}
              </span>
            </div>

            {event.organizer && (
              <Link
                href={`/organizer/${event.organizer.slug}`}
                className="mt-1 flex w-fit items-center gap-2 text-muted-foreground transition-colors hover:underline"
              >
                <Users className="h-4 w-4" />
                <span>Organized by {event.organizer.name}</span>
              </Link>
            )}

            {event.eventUrl && (
              <a
                href={event.eventUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 flex w-fit items-center gap-2 text-muted-foreground transition-colors hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                <span>View on {sourceLabel}</span>
              </a>
            )}

            <div className="mt-2 flex flex-wrap gap-2">
              {event.categories?.map((category) => (
                <Badge
                  key={category}
                  variant="secondary"
                  className="capitalize"
                >
                  {categoryLabelMap[category] || category}
                </Badge>
              ))}
            </div>

            {!isCancelledEvent && (
              <>
                {/* RSVP Buttons - Shared across mobile and desktop */}
                <div className="flex gap-2 py-4">
                  <Button
                    variant={
                      event.userRsvp?.status === "interested"
                        ? "secondary"
                        : "outline"
                    }
                    className="flex-1 text-base font-medium"
                    size="lg"
                    onClick={() => handleRsvp("interested")}
                    disabled={
                      rsvpMutation.isPending || deleteRsvpMutation.isPending
                    }
                  >
                    {interestedLabel}
                  </Button>
                  <Button
                    variant={
                      event.userRsvp?.status === "going" ? "default" : "outline"
                    }
                    className={cn(
                      "flex-1 text-base font-medium transition-colors",
                      event.userRsvp?.status === "going" &&
                        "border-transparent bg-green-500 text-black hover:bg-green-600"
                    )}
                    size="lg"
                    onClick={() => handleRsvp("going")}
                    disabled={
                      rsvpMutation.isPending || deleteRsvpMutation.isPending
                    }
                  >
                    {event.userRsvp?.status === "going" ? "Going" : goingLabel}
                  </Button>
                </div>
                {hasActivePartner && (
                  <div className="mb-4 w-full text-sm text-muted-foreground sm:w-fit">
                    <label
                      htmlFor="include-partner"
                      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-full border border-border px-4 py-2 sm:min-w-[220px]"
                    >
                      <span className="text-foreground">
                        Going with {myPartner.partner.firstName}
                      </span>
                      <Switch
                        id="include-partner"
                        checked={includePartner}
                        onCheckedChange={setIncludePartner}
                        disabled={
                          rsvpMutation.isPending || deleteRsvpMutation.isPending
                        }
                      />
                    </label>
                  </div>
                )}
              </>
            )}

            {/*<Separator />*/}

            {/* About Section */}
            <div className={"pt-4"}>
              <h2 className="mb-2 text-2xl font-bold">About</h2>

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
            {attendees && attendees.length > 0 && (
              <div className={"pt-4"}>
                <h2 className="mb-4 text-2xl font-bold">Who&apos;s Going</h2>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  {attendees
                    .filter((a) => a.status === "going")
                    .slice(0, 9)
                    .map((attendee) => (
                      <div
                        key={attendee.user.id}
                        className="flex items-center gap-3 rounded-lg border bg-card p-3"
                      >
                        <UserAvatar
                          src={attendee.user.avatarImageUrl}
                          name={attendee.user.firstName}
                          className="h-10 w-10"
                        />
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
          </div>
        </div>
      </div>
    </div>
  );
}
