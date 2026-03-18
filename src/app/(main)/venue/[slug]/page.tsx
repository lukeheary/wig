"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import Image from "next/image";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { EventCardGrid } from "@/components/events/event-card-grid";
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
import { useAuth } from "@clerk/nextjs";
import { VenueHoursDisplay } from "@/components/venue-hours-display";
import { VenueHours } from "@/components/venue-hours-editor";
import pluralize from "pluralize";
import { cn } from "@/lib/utils";
import { StickySectionHeader } from "@/components/ui/sticky-section-header";
import { CategoryPillList } from "@/components/categories/category-pill";
import { PlaceActionMenu } from "@/components/places/place-action-menu";
import { PlacePageSkeleton } from "@/components/places/place-page-skeleton";
import { EventsPlaceholder } from "@/components/shared/events-placeholder";

export default function PlacePage() {
  const params = useParams();
  const slug = params.slug as string;
  const { userId } = useAuth();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [expandedImage, setExpandedImage] = useState<{
    url: string;
    alt: string;
  } | null>(null);

  // Fetch place data
  const { data: place, isLoading } = trpc.place.getPlaceBySlug.useQuery({
    slug,
  });

  // Check if following
  const { data: isFollowing } = trpc.place.isFollowingPlace.useQuery(
    { placeId: place?.id || "" },
    { enabled: !!place?.id }
  );

  // Check if user is admin
  const { data: adminCheck } = trpc.user.isAdmin.useQuery();
  const isAdmin = adminCheck?.isAdmin ?? false;

  // Get current user
  const { data: currentUser } = trpc.user.getCurrentUser.useQuery();

  // Follow mutation
  const followMutation = trpc.place.followPlace.useMutation({
    onSuccess: () => {
      // toast({
      //   title: "Success",
      //   description: `You are now following this ${place?.type === "venue" ? "venue" : "organizer"}`,
      // });
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

  // Unfollow mutation
  const unfollowMutation = trpc.place.unfollowPlace.useMutation({
    onSuccess: () => {
      // toast({
      //   title: "Success",
      //   description: `You unfollowed this ${place?.type === "venue" ? "venue" : "organizer"}`,
      // });
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
  const TypeIcon = isVenue ? Building : Building2;
  const displayWebsite = place.website
    ?.replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/(\.com).*/i, "$1");

  // Check if user can edit this place (admin or member)
  const isMember =
    currentUser &&
    place.members?.some((member: any) => member.userId === currentUser.id);
  const canEdit = isAdmin || isMember;

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
            <div className="flex items-center gap-4">
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
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                  {place.name}
                </h1>
                <p className="text-muted-foreground">@{place.slug}</p>
                <CategoryPillList
                  categories={place.categories || []}
                  categoryLabelMap={(place as any).categoryLabels}
                  className="pt-2"
                />
              </div>
            </div>

            <div className="hidden items-center gap-2 md:flex">
              <Button
                variant={isFollowing ? "outline" : "default"}
                onClick={handleFollowToggle}
                disabled={
                  followMutation.isPending || unfollowMutation.isPending
                }
                className="rounded-full"
              >
                {isFollowing ? (
                  <>
                    <Heart className="mr-2 h-4 w-4 fill-current" />
                    Following
                  </>
                ) : (
                  <>
                    <Heart className="mr-2 h-4 w-4" />
                    Follow
                  </>
                )}
              </Button>
              {canEdit && (
                <PlaceActionMenu
                  placeId={place.id}
                  slug={slug}
                  type="venue"
                  isAdmin={isAdmin}
                />
              )}
            </div>
          </div>
        </div>

        {/* Place Info */}
        <div className="mt-4 space-y-4">
          {place.description && (
            <div>
              <p className="whitespace-pre-wrap leading-normal">
                {place.description}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-x-4 gap-y-2 text-muted-foreground">
            {/*<div className="flex items-center gap-1">*/}
            {/*  <TypeIcon className="h-4 w-4" />*/}
            {/*  <span>{isVenue ? "Venue" : "Organizer"}</span>*/}
            {/*</div>*/}
            {isVenue ? (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span>{place.address}</span>
              </div>
            ) : place.city && place.state ? (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span>
                  {place.city}, {place.state}
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

          {/* Mobile follow button */}
          <div className="flex items-center gap-2 md:hidden">
            <Button
              variant={isFollowing ? "outline" : "default"}
              onClick={handleFollowToggle}
              disabled={followMutation.isPending || unfollowMutation.isPending}
              className="flex-1 rounded-full"
            >
              {isFollowing ? (
                <>
                  <Heart className="mr-2 h-4 w-4 fill-current" />
                  Following
                </>
              ) : (
                <>
                  <Heart className="mr-2 h-4 w-4" />
                  Follow
                </>
              )}
            </Button>
            {canEdit && (
              <PlaceActionMenu placeId={place.id} slug={slug} type="venue" />
            )}
          </div>

          {/*<div className="flex items-center gap-4 text-sm">*/}
          {/*  <div className="flex items-center gap-1">*/}
          {/*    <span className="font-bold">*/}
          {/*      {(place as any).follows?.length || 0}*/}
          {/*    </span>*/}
          {/*    <span className="text-muted-foreground">*/}
          {/*      {pluralize("follower", (place as any).follows?.length || 0)}*/}
          {/*    </span>*/}
          {/*  </div>*/}
          {/*  <div className="flex items-center gap-1">*/}
          {/*    <span className="font-bold">*/}
          {/*      {(place as any).events?.length || 0}*/}
          {/*    </span>*/}
          {/*    <span className="text-muted-foreground">*/}
          {/*      {pluralize("event", (place as any).events?.length || 0)}*/}
          {/*    </span>*/}
          {/*  </div>*/}
          {/*</div>*/}
        </div>
      </div>

      <div className="pt-4">
        <StickySectionHeader>
          <span className="text-xl font-semibold">Upcoming Events</span>
        </StickySectionHeader>
        <div className="container mx-auto">
          {place.events && place.events.length > 0 ? (
            <EventCardGrid
              events={place.events}
              columns={{ mobile: 1, tablet: 3, desktop: 4 }}
              gap="md"
            />
          ) : (
            <EventsPlaceholder />
          )}
        </div>
      </div>

      {/* Previous Events */}
      {place.pastEvents && (place.pastEvents as any[]).length > 0 && (
        <div className="pt-4">
          <StickySectionHeader>
            <span className="text-xl font-semibold">Past Events</span>
          </StickySectionHeader>
          <div className="container mx-auto">
            <EventCardGrid
              events={place.pastEvents as any}
              columns={{ mobile: 1, tablet: 3, desktop: 4 }}
              gap="md"
            />
          </div>
        </div>
      )}
    </div>
  );
}
