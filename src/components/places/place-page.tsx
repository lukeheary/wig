"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  Globe,
  Instagram,
  Heart,
  Building,
  Building2,
  ChevronDown,
  ChevronLeft,
  MoreHorizontal,
  Plus,
  Share2,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { VenueHoursDisplay } from "@/components/venue-hours-display";
import { VenueHours } from "@/components/venue-hours-editor";
import { cn } from "@/lib/utils";
import { CategoryPillList } from "@/components/categories/category-pill";
import { PlaceActionMenu } from "@/components/places/place-action-menu";
import { PlacePageSkeleton } from "@/components/places/place-page-skeleton";
import { PlaceUpcomingEvents } from "@/components/places/place-upcoming-events";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HapticPreset, useHaptics } from "@/hooks/use-haptics";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type PlacePageProps = {
  actionMenuType: "venue" | "organizer";
};

export function PlacePage({ actionMenuType }: PlacePageProps) {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const { toast } = useToast();
  const { triggerHaptic } = useHaptics();
  const utils = trpc.useUtils();
  const [expandedImage, setExpandedImage] = useState<{
    url: string;
    alt: string;
  } | null>(null);
  const [eventsTab, setEventsTab] = useState<"upcoming" | "past">("upcoming");

  const { data: place, isLoading } = trpc.place.getPlaceBySlug.useQuery({
    slug,
    type: actionMenuType,
  });
  const pastEventsQuery = trpc.place.getPastEvents.useInfiniteQuery(
    { slug, type: actionMenuType, limit: 24 },
    {
      enabled: eventsTab === "past" && Boolean(place),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }
  );
  const pastEvents = useMemo(() => {
    const pagedEvents = pastEventsQuery.data?.pages.flatMap(
      (page) => page.events
    );
    return pagedEvents ?? place?.pastEvents ?? [];
  }, [pastEventsQuery.data, place?.pastEvents]);
  const loadMorePastEvents = useCallback(() => {
    if (pastEventsQuery.hasNextPage && !pastEventsQuery.isFetchingNextPage) {
      void pastEventsQuery.fetchNextPage();
    }
  }, [pastEventsQuery]);

  const { data: isFollowing } = trpc.place.isFollowingPlace.useQuery(
    { placeId: place?.id || "" },
    { enabled: !!place?.id }
  );

  const { data: adminCheck } = trpc.user.isAdmin.useQuery();
  const isAdmin = adminCheck?.isAdmin ?? false;

  const { data: currentUser } = trpc.user.getCurrentUser.useQuery();

  const followMutation = trpc.place.followPlace.useMutation({
    onSuccess: () => {
      utils.place.isFollowingPlace.invalidate();
      utils.place.getPlaceBySlug.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const unfollowMutation = trpc.place.unfollowPlace.useMutation({
    onSuccess: () => {
      utils.place.isFollowingPlace.invalidate();
      utils.place.getPlaceBySlug.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFollowToggle = () => {
    if (!place) return;

    if (isFollowing) {
      unfollowMutation.mutate({ placeId: place.id });
    } else {
      followMutation.mutate({ placeId: place.id });
    }
  };

  if (isLoading) {
    return <PlacePageSkeleton />;
  }

  if (!place) {
    return (
      <div className="container mx-auto py-12 text-center">
        <Building className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="mb-2 text-2xl font-bold">Place not found</h2>
        <p className="mb-4 text-muted-foreground">
          The place you&apos;re looking for doesn&apos;t exist
        </p>
        <Link href="/places">
          <Button>Browse Places</Button>
        </Link>
      </div>
    );
  }

  const isVenue = place.type === "venue";
  const displayWebsite = place.website
    ?.replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/(\.com).*/i, "$1");

  const isMember =
    currentUser &&
    place.members?.some(
      (member: { userId: string }) => member.userId === currentUser.id
    );
  const canEdit = isAdmin || Boolean(isMember);
  const hasPastEvents = pastEvents.length > 0;
  const followButtonClassName = cn(
    "font-space-grotesk rounded-xl py-6 text-base font-medium lg:text-lg",
    isFollowing &&
      "border-transparent bg-neon-teal text-black hover:bg-neon-teal-hover hover:text-black active:text-black"
  );
  const mobileAddress = [place.address, place.city, place.state]
    .filter(Boolean)
    .join(", ");
  const createEventHref = `/event/new?${isVenue ? "venueId" : "organizerId"}=${place.id}`;
  const sharePlace = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: place.name, url });
      return;
    }
    await navigator.clipboard.writeText(url);
  };
  const mobileEventSelector = (
    <label className="relative flex items-center text-sm font-medium text-muted-foreground">
      <select
        aria-label="Place events"
        value={eventsTab}
        onChange={(event) =>
          setEventsTab(event.target.value as "upcoming" | "past")
        }
        className="cursor-pointer appearance-none bg-transparent py-1 pl-3 pr-6 text-right capitalize"
      >
        <option value="upcoming">Upcoming</option>
        <option value="past">Past</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4" />
    </label>
  );

  return (
    <div className="min-h-screen bg-black pb-6 md:bg-background">
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xl"
          onClick={() => setExpandedImage(null)}
        >
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-4 top-4 h-10 w-10 text-white hover:bg-white/20"
            onClick={() => setExpandedImage(null)}
          >
            <X className="h-6 w-6" />
          </Button>
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={expandedImage.url}
              alt={expandedImage.alt}
              width={1200}
              height={800}
              className="h-auto max-h-[90vh] w-auto max-w-[90vw] object-contain"
            />
          </div>
        </div>
      )}

      <section className="mx-auto px-5 pb-4 pt-3 md:hidden">
        <div className="flex h-12 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            className="h-12 w-12 shrink-0 rounded-full border border-white/15 bg-[#242426]/85 text-white shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl hover:bg-[#242426]/85"
            aria-label="Go back"
          >
            <ChevronLeft className="h-[18px] w-[18px]" />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-[17px] font-bold text-white">
            {place.slug}
          </h1>
          {canEdit ? (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-12 w-12 shrink-0 rounded-3xl border border-white/15 bg-[#242426]/85 text-white shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl hover:bg-[#242426]/85"
            >
              <Link href={createEventHref} aria-label="Create event">
                <Plus className="h-5 w-5" />
              </Link>
            </Button>
          ) : null}
          {canEdit ? (
            <PlaceActionMenu
              placeId={place.id}
              slug={slug}
              type={actionMenuType}
              isAdmin={isAdmin}
              triggerClassName="h-12 w-12 shrink-0 rounded-3xl border border-white/15 bg-[#242426]/85 text-white shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl hover:bg-[#242426]/85"
            />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-12 w-12 shrink-0 rounded-3xl border border-white/15 bg-[#242426]/85 text-white shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl hover:bg-[#242426]/85"
                  aria-label="Place options"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56 border-white/15 bg-[#242426]/95 p-2 backdrop-blur-2xl"
              >
                <DropdownMenuItem
                  onSelect={() => void sharePlace()}
                  className="cursor-pointer gap-4 py-3 text-base"
                >
                  <Share2 />
                  Share Place
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="mt-12 flex items-end gap-5">
          <button
            type="button"
            onClick={() =>
              place.logoImageUrl &&
              setExpandedImage({
                url: place.logoImageUrl,
                alt: `${place.name} profile`,
              })
            }
            className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#111113]"
          >
            {place.logoImageUrl ? (
              <Image
                src={place.logoImageUrl}
                alt={place.name}
                fill
                sizes="112px"
                className="object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                {isVenue ? (
                  <Building className="h-8 w-8 text-white/25" />
                ) : (
                  <Building2 className="h-8 w-8 text-white/25" />
                )}
              </span>
            )}
          </button>

          <div className="min-w-0 flex-1 pb-1">
            <div className="translate-y-1.5">
              <h2 className="truncate text-xl font-bold tracking-tight text-white">
                {place.name}
              </h2>
              {mobileAddress ? (
                <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
                  {mobileAddress}
                </p>
              ) : null}
            </div>
            <div className="mt-5 grid grid-cols-3">
              <div className="flex flex-col">
                <span className="text-lg font-semibold text-white">
                  {place.events?.length ?? 0}
                </span>
                <span className="text-xs text-muted-foreground">Upcoming</span>
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-semibold text-white">
                  {place.follows?.length ?? 0}
                </span>
                <span className="text-xs text-muted-foreground">Followers</span>
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-semibold text-white">
                  {place.members?.length ?? 0}
                </span>
                <span className="text-xs text-muted-foreground">Members</span>
              </div>
            </div>
          </div>
        </div>

        <Button
          type="button"
          onClick={handleFollowToggle}
          disabled={followMutation.isPending || unfollowMutation.isPending}
          className={cn(
            "mt-6 h-12 w-full rounded-xl text-base font-semibold",
            isFollowing
              ? "border border-white/15 bg-white/[0.07] text-white hover:bg-white/[0.09]"
              : "bg-sky-300 text-black hover:bg-sky-300/90"
          )}
        >
          {isFollowing ? "Following" : "Follow"}
        </Button>
      </section>

      <div className="container mx-auto hidden md:block">
        <div>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-4">
              <div
                className={cn(
                  "relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-2xl bg-muted shadow-sm md:h-32 md:w-32",
                  place.logoImageUrl && "cursor-pointer"
                )}
                onClick={() =>
                  place.logoImageUrl &&
                  setExpandedImage({
                    url: place.logoImageUrl,
                    alt: `${place.name} profile`,
                  })
                }
              >
                {place.logoImageUrl ? (
                  <Image
                    src={place.logoImageUrl}
                    alt={place.name}
                    fill
                    className="object-cover"
                    sizes="(min-width: 768px) 128px, 96px"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    {isVenue ? (
                      <Building className="h-10 w-10 text-muted-foreground/40" />
                    ) : (
                      <Building2 className="h-10 w-10 text-muted-foreground/40" />
                    )}
                  </div>
                )}
              </div>

              <div className={"flex flex-col justify-center md:space-y-1"}>
                <h1 className="font-space-grotesk text-3xl font-bold tracking-tight md:text-4xl">
                  {place.name}
                </h1>
                <p className="text-base text-muted-foreground md:text-lg">
                  @{place.slug}
                </p>
                <CategoryPillList
                  categories={place.categories || []}
                  categoryLabelMap={(place as any).categoryLabels}
                  variant={"small"}
                  className="pt-1.5"
                />
              </div>
            </div>

            <div className="hidden items-center gap-2 md:flex">
              <Button
                variant="neon"
                onClick={handleFollowToggle}
                disabled={
                  followMutation.isPending || unfollowMutation.isPending
                }
                size="lg"
                className={cn("min-w-[160px] !py-5", followButtonClassName)}
              >
                {isFollowing ? <>Following</> : <>Follow</>}
              </Button>
              {canEdit && (
                <PlaceActionMenu
                  placeId={place.id}
                  slug={slug}
                  type={actionMenuType}
                  isAdmin={isAdmin}
                />
              )}
            </div>
          </div>
        </div>

        <div className="mt-4">
          {place.description && (
            <div>
              <p className="whitespace-pre-wrap leading-normal">
                {place.description}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-x-4 gap-y-2 text-muted-foreground">
            {isVenue ? (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span>{place.address}</span>
              </div>
            ) : place.city && place.state ? (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span>
                  {place.city}, {place.state}{" "}
                  <span className={"text-muted-foreground/60"}>
                    (Organizer)
                  </span>
                </span>
              </div>
            ) : null}

            {isVenue && (place as any).hours && (
              <VenueHoursDisplay hours={(place as any).hours as VenueHours} />
            )}

            {(place.instagram || place.website) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {place.instagram && (
                  <a
                    href={`https://instagram.com/${place.instagram}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-fit items-center gap-2 text-muted-foreground hover:underline"
                  >
                    <Instagram className="h-4 w-4" />
                    <span>@{place.instagram}</span>
                  </a>
                )}

                {place.website && (
                  <a
                    href={place.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-fit items-center gap-2 text-muted-foreground hover:underline"
                  >
                    <Globe className="h-4 w-4" />
                    <span>{displayWebsite}</span>
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2 md:hidden">
            <Button
              variant="neon"
              onClick={handleFollowToggle}
              size="lg"
              disabled={followMutation.isPending || unfollowMutation.isPending}
              className={cn("flex-1 !py-5", followButtonClassName)}
            >
              {isFollowing ? <>Following</> : <>Follow</>}
            </Button>
            {canEdit && (
              <PlaceActionMenu
                placeId={place.id}
                slug={slug}
                type={actionMenuType}
              />
            )}
          </div>

          {hasPastEvents && (
            <div className="pt-4">
              <Tabs
                value={eventsTab}
                onValueChange={(value) => {
                  if (value !== eventsTab) {
                    void triggerHaptic(HapticPreset.Light);
                  }
                  setEventsTab(value as "upcoming" | "past");
                }}
              >
                <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl bg-muted p-1">
                  <TabsTrigger
                    value="upcoming"
                    className="font-space-grotesk rounded-lg py-2 text-base"
                  >
                    Upcoming
                  </TabsTrigger>
                  <TabsTrigger
                    value="past"
                    className="font-space-grotesk rounded-lg py-2 text-base"
                  >
                    Past
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}
        </div>
      </div>

      {eventsTab === "past" ? (
        <PlaceUpcomingEvents
          events={pastEvents as any}
          mode="past"
          headerTrailing={mobileEventSelector}
          hasMore={pastEventsQuery.hasNextPage ?? false}
          isLoadingMore={pastEventsQuery.isFetchingNextPage}
          onLoadMore={loadMorePastEvents}
        />
      ) : (
        <PlaceUpcomingEvents
          events={place.events}
          headerTrailing={mobileEventSelector}
        />
      )}
    </div>
  );
}
