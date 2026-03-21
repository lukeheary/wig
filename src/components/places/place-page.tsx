"use client";

import Link from "next/link";
import { useState } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  Globe,
  Instagram,
  Heart,
  Building,
  Building2,
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

type PlacePageProps = {
  actionMenuType: "venue" | "organizer";
};

export function PlacePage({ actionMenuType }: PlacePageProps) {
  const params = useParams();
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
  });

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
        <Link href="/venues-and-organizers">
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
  const hasPastEvents = (place.pastEvents as any[] | undefined)?.length
    ? (place.pastEvents as any[]).length > 0
    : false;
  const followButtonClassName = cn(
    "font-space-grotesk rounded-xl py-6 text-base font-medium lg:text-lg",
    isFollowing &&
      "border-transparent bg-neon-teal text-black hover:bg-neon-teal-hover hover:text-black active:text-black"
  );

  return (
    <div className="bg-background pb-6">
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

      <div className="container mx-auto">
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

              <div>
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

      {eventsTab === "past" && hasPastEvents ? (
        <PlaceUpcomingEvents events={place.pastEvents as any} mode="past" />
      ) : (
        <PlaceUpcomingEvents events={place.events} />
      )}
    </div>
  );
}
