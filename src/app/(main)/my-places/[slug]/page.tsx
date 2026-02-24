"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PlaceMembersManager } from "@/components/places/place-members-manager";
import {
  Loader2,
  Building,
  Building2,
  Plus,
  Repeat,
  Calendar,
  Users,
  Heart,
  MapPin,
  Globe,
  Instagram,
  Edit,
  ExternalLink,
  CalendarPlus,
  Eye,
} from "lucide-react";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { cn } from "@/lib/utils";

export default function ManagePlacePage() {
  const params = useParams();
  const slug = params.slug as string;
  const router = useRouter();

  const { data: place, isLoading } = trpc.place.getPlaceBySlug.useQuery({
    slug,
  });

  const { data: placeMembers } = trpc.place.getPlaceMembers.useQuery(
    { placeId: place?.id || "" },
    { enabled: !!place?.id }
  );

  const { data: adminCheck } = trpc.user.isAdmin.useQuery();
  const isAdmin = adminCheck?.isAdmin ?? false;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!place) {
    return (
      <div className="container mx-auto py-12 text-center">
        <Building className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="mb-2 text-2xl font-bold">Place not found</h2>
        <p className="mb-4 text-muted-foreground">
          The place you&apos;re looking for doesn&apos;t exist
        </p>
        <Link href="/my-places">
          <Button>Back to My Places</Button>
        </Link>
      </div>
    );
  }

  const isVenue = place.type === "venue";
  const TypeIcon = isVenue ? Building : Building2;
  const typeLabel = isVenue ? "Venue" : "Organizer";
  const upcomingEvents = place.events || [];
  const pastEvents = (place as any).pastEvents || [];
  const totalFollowers = (place as any).follows?.length || 0;
  const totalMembers = placeMembers?.length || 0;
  const recurringSeries = Object.values(
    upcomingEvents.reduce(
      (acc: Record<string, { seriesId: string; title: string; events: any[] }>, event: any) => {
        if (!event.seriesId) return acc;
        if (!acc[event.seriesId]) {
          acc[event.seriesId] = {
            seriesId: event.seriesId,
            title: event.title,
            events: [],
          };
        }
        acc[event.seriesId].events.push(event);
        return acc;
      },
      {}
    )
  )
    .map((series) => {
      const sortedEvents = [...series.events].sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
      );
      return {
        ...series,
        nextEvent: sortedEvents[0],
        upcomingOccurrences: sortedEvents.length,
      };
    })
    .sort(
      (a, b) =>
        new Date(a.nextEvent.startAt).getTime() -
        new Date(b.nextEvent.startAt).getTime()
    );

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <BackButtonHeader onBack={() => router.back()} className="items-center">
        <h1 className="text-2xl font-bold tracking-tight">{place.name}</h1>
        <p className="text-sm text-muted-foreground"></p>
      </BackButtonHeader>

      {/* Stats Cards - 2x2 grid on mobile, 4 columns on desktop */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 sm:h-10 sm:w-10">
              <Calendar className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
            </div>
            <div className="flex min-w-0 flex-row items-center gap-2">
              <p className="text-xl font-bold sm:text-2xl">
                {upcomingEvents.length}
              </p>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">
                Upcoming
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/10 sm:h-10 sm:w-10">
              <Calendar className="h-4 w-4 text-blue-500 sm:h-5 sm:w-5" />
            </div>
            <div className="flex min-w-0 flex-row items-center gap-2">
              <p className="text-xl font-bold sm:text-2xl">
                {pastEvents.length}
              </p>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">
                Past
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pink-500/10 sm:h-10 sm:w-10">
              <Heart className="h-4 w-4 text-pink-500 sm:h-5 sm:w-5" />
            </div>
            <div className="flex min-w-0 flex-row items-center gap-2">
              <p className="text-xl font-bold sm:text-2xl">{totalFollowers}</p>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">
                Followers
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-500/10 sm:h-10 sm:w-10">
              <Users className="h-4 w-4 text-green-500 sm:h-5 sm:w-5" />
            </div>
            <div className="flex min-w-0 flex-row items-center gap-2">
              <p className="text-xl font-bold sm:text-2xl">{totalMembers}</p>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">
                Team
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Upcoming Events */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-lg font-semibold">
                Upcoming Events
              </CardTitle>
              <Link
                href={`/event/new?${isVenue ? "venueId" : "organizerId"}=${place.id}`}
              >
                <Button variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Event
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="overflow-hidden">
              {upcomingEvents.length > 0 ? (
                <div className="space-y-2 sm:space-y-3">
                  {upcomingEvents.slice(0, 5).map((event: any) => (
                    <Link
                      key={event.id}
                      href={`/event/${event.id}`}
                      className="flex items-center gap-3 overflow-hidden rounded-lg border p-2 transition-colors hover:bg-muted/50 sm:gap-4 sm:p-3"
                    >
                      {event.coverImageUrl ? (
                        <img
                          src={event.coverImageUrl}
                          alt={event.title}
                          className="h-12 w-12 shrink-0 rounded-md object-cover sm:h-16 sm:w-16"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted sm:h-16 sm:w-16">
                          <Calendar className="h-5 w-5 text-muted-foreground sm:h-6 sm:w-6" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="truncate text-sm font-medium sm:text-base">
                          {event.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground sm:text-sm">
                          {format(
                            new Date(event.startAt),
                            "EEE, MMM d · h:mm a"
                          )}
                        </p>
                        {event.venue?.name && (
                          <p className="hidden truncate text-sm text-muted-foreground sm:block">
                            {event.venue.name}
                          </p>
                        )}
                      </div>
                      <ExternalLink className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
                    </Link>
                  ))}
                  {upcomingEvents.length > 5 && (
                    <Link
                      href={`/${isVenue ? "venue" : "organizer"}/${place.slug}`}
                      className="block text-center text-sm text-muted-foreground hover:text-primary"
                    >
                      View all {upcomingEvents.length} events
                    </Link>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <Calendar className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                  <p className="mb-1 font-medium">No upcoming events</p>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Create your first event to get started
                  </p>
                  <Link
                    href={`/event/new?${isVenue ? "venueId" : "organizerId"}=${place.id}`}
                  >
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Event
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recurring Events */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-lg font-semibold">
                Recurring Events
              </CardTitle>
              <Link
                href={`/event/new?recurring=true&${isVenue ? "venueId" : "organizerId"}=${place.id}`}
              >
                <Button variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Recurring Event
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="overflow-hidden">
              {recurringSeries.length > 0 ? (
                <div className="space-y-2 sm:space-y-3">
                  {recurringSeries.slice(0, 5).map((series) => (
                    <div
                      key={series.seriesId}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium sm:text-base">
                          {series.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground sm:text-sm">
                          Next:{" "}
                          {format(
                            new Date(series.nextEvent.startAt),
                            "EEE, MMM d · h:mm a"
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground sm:text-sm">
                          {series.upcomingOccurrences} upcoming{" "}
                          {series.upcomingOccurrences === 1
                            ? "occurrence"
                            : "occurrences"}
                        </p>
                      </div>
                      <Link href={`/event-series/${series.seriesId}/edit`}>
                        <Button variant="outline" size="sm">
                          Edit
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <Repeat className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                  <p className="mb-1 font-medium">No recurring events yet</p>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Add a recurring event series for this {typeLabel.toLowerCase()}
                  </p>
                  <Link
                    href={`/event/new?recurring=true&${isVenue ? "venueId" : "organizerId"}=${place.id}`}
                  >
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Recurring Event
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Team Members */}
          <PlaceMembersManager
            placeId={place.id}
            placeName={place.name}
            placeType={place.type as "venue" | "organizer"}
            canManage={isAdmin}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                href={`/event/new?${isVenue ? "venueId" : "organizerId"}=${place.id}`}
                className="block"
              >
                <Button variant="outline" className="w-full justify-start">
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  Create New Event
                </Button>
              </Link>
              <Link
                href={`/event/new?recurring=true&${isVenue ? "venueId" : "organizerId"}=${place.id}`}
                className="block"
              >
                <Button variant="outline" className="w-full justify-start">
                  <Repeat className="mr-2 h-4 w-4" />
                  Add Recurring Event
                </Button>
              </Link>
              <Link
                href={`/${isVenue ? "venue" : "organizer"}/${place.slug}`}
                className="block"
              >
                <Button variant="outline" className="w-full justify-start">
                  <Eye className="mr-2 h-4 w-4" />
                  View Public Page
                </Button>
              </Link>
              <Link
                href={`/${isVenue ? "venue" : "organizer"}/${place.slug}/edit`}
                className="block"
              >
                <Button variant="outline" className="w-full justify-start">
                  <Edit className="mr-2 h-4 w-4" />
                  Edit {typeLabel}
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Place Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {place.description ? (
                <p className="text-sm text-muted-foreground">
                  {place.description}
                </p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  No description added yet
                </p>
              )}

              <div className="space-y-3 text-sm">
                {place.address && (
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>{place.address}</span>
                  </div>
                )}
                {place.city && place.state && !place.address && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>
                      {place.city}, {place.state}
                    </span>
                  </div>
                )}
                {place.website && (
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <a
                      href={place.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-primary hover:underline"
                    >
                      {place.website.replace(/^https?:\/\//, "")}
                    </a>
                  </div>
                )}
                {place.instagram && (
                  <div className="flex items-center gap-2">
                    <Instagram className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <a
                      href={`https://instagram.com/${place.instagram}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      @{place.instagram}
                    </a>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
