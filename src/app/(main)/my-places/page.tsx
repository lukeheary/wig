"use client";

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building,
  Building2,
  MapPin,
  Calendar,
  Users as UsersIcon,
  Loader2,
  Repeat,
} from "lucide-react";
import pluralize from "pluralize";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/shared/page-container";

export default function MyPlacesPage() {
  const { data: myPlaces, isLoading } = trpc.place.getMyPlaces.useQuery();

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const venues = myPlaces?.filter((p) => p.type === "venue") || [];
  const organizers = myPlaces?.filter((p) => p.type === "organizer") || [];
  const hasOnlyOneVenue = venues.length === 1 && organizers.length === 0;
  const hasOnlyOneOrganizer = organizers.length === 1 && venues.length === 0;

  const showVenuesSection = !hasOnlyOneOrganizer;
  const showOrganizersSection = !hasOnlyOneVenue;

  return (
    <PageContainer className="space-y-4">
      {/*<div className="flex justify-end">*/}
      {/*  <Link href="/event/new?recurring=true">*/}
      {/*    <Button>*/}
      {/*      <Repeat className="mr-2 h-4 w-4" />*/}
      {/*      Create New Recurring Event*/}
      {/*    </Button>*/}
      {/*  </Link>*/}
      {/*</div>*/}

      {/* Venues Section */}
      {showVenuesSection && (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              My Venues
            </h1>
          </div>

          {venues.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {venues.map((place) => (
                <Link
                  key={place.id}
                  href={`/my-places/${place.slug}`}
                  className="block"
                >
                  <Card className="transition-colors hover:bg-accent/50">
                    <CardHeader className={"pb-2"}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">
                            {place.name}
                          </CardTitle>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {place.description && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {place.description}
                        </p>
                      )}

                      {place.city && place.state && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          <span>
                            {place.city}, {place.state}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          <UsersIcon className="mr-1 h-3 w-3" />
                          {(place as any).members?.length || 0}{" "}
                          {pluralize(
                            "member",
                            (place as any).members?.length || 0
                          )}
                        </Badge>
                        <Badge variant="outline">
                          <Calendar className="mr-1 h-3 w-3" />
                          {(place as any).events?.length || 0} upcoming
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Building className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-semibold">No venues yet</h3>
                <p className="mb-4 text-muted-foreground">
                  You are not a member of any venues. Contact an admin to be
                  added to a venue.
                </p>
                <Link href="/venues-and-organizers?filter=venues">
                  <Button>Browse Venues</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Organizers Section */}
      {showOrganizersSection && (
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
              My Organizers
            </h2>
          </div>

          {organizers.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {organizers.map((place) => (
                <Link
                  key={place.id}
                  href={`/my-places/${place.slug}`}
                  className="block"
                >
                  <Card className="transition-colors hover:bg-accent/50">
                    <CardHeader className={"pb-2"}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">
                            {place.name}
                          </CardTitle>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {place.description && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {place.description}
                        </p>
                      )}

                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          <UsersIcon className="mr-1 h-3 w-3" />
                          {(place as any).members?.length || 0}{" "}
                          {pluralize(
                            "member",
                            (place as any).members?.length || 0
                          )}
                        </Badge>
                        <Badge variant="outline">
                          <Calendar className="mr-1 h-3 w-3" />
                          {(place as any).events?.length || 0} upcoming
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Building2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-semibold">
                  No organizers yet
                </h3>
                <p className="mb-4 text-muted-foreground">
                  You are not a member of any organizers. Contact an admin to be
                  added to an organizer.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PageContainer>
  );
}
