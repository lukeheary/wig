"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Building, Building2, ChevronRight, Plus, Search } from "lucide-react";
import {
  PlaceEditForm,
  type PlaceFormData,
  type PlaceType,
} from "@/components/places/place-edit-form";
import { BackButtonHeader } from "@/components/shared/back-button-header";

type ViewMode = "list" | "create";

type AdminPlacesPageProps = {
  placeType: PlaceType;
};

export function AdminPlacesPage({ placeType }: AdminPlacesPageProps) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const searchParams = useSearchParams();
  const didInitFromParams = useRef(false);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (didInitFromParams.current) return;

    const shouldOpenCreate = ["1", "true", "yes"].includes(
      searchParams.get("create")?.toLowerCase() ?? ""
    );

    if (shouldOpenCreate) {
      setViewMode("create");
    }

    didInitFromParams.current = true;
  }, [searchParams]);

  const { data: places } = trpc.admin.listAllPlaces.useQuery({
    type: placeType,
  });

  const createPlaceMutation = trpc.admin.createPlace.useMutation();
  const upsertPlaceScraperMutation = trpc.admin.upsertPlaceScraper.useMutation();

  const handleBack = () => {
    setViewMode("list");
  };

  const handleCreateSubmit = async (formData: PlaceFormData) => {
    try {
      const {
        scraper,
        scraperSearchString,
        scraperClassificationName,
        ...placeData
      } = formData;

      const createdPlace = await createPlaceMutation.mutateAsync({
        ...placeData,
        latitude: placeData.latitude ?? undefined,
        longitude: placeData.longitude ?? undefined,
      });

      let scraperWarning: string | null = null;
      try {
        await upsertPlaceScraperMutation.mutateAsync({
          placeId: createdPlace.id,
          scraper,
          searchString: scraperSearchString,
          classificationName: scraperClassificationName,
        });
      } catch (error) {
        scraperWarning =
          error instanceof Error ? error.message : "Failed to save scraper";
      }

      const placeLabel = placeType === "venue" ? "Venue" : "Organizer";
      toast({
        title: "Success",
        description: scraperWarning
          ? `${placeLabel} created, but scraper setup failed: ${scraperWarning}`
          : `${placeLabel} created successfully`,
      });

      setViewMode("list");
      await utils.admin.listAllPlaces.invalidate({ type: placeType });
      await utils.admin.listScrapers.invalidate();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Create failed",
        variant: "destructive",
      });
    }
  };

  const filteredPlaces = places
    ?.filter(
      (place) =>
        place.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (place.city &&
          place.city.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const isVenue = placeType === "venue";
  const title = isVenue ? "Venues" : "Organizers";
  const itemLabel = isVenue ? "venue" : "organizer";
  const TypeIcon = isVenue ? Building : Building2;

  if (viewMode === "create") {
    return (
      <div className="space-y-6">
        <BackButtonHeader onBack={handleBack} title={`Create ${isVenue ? "Venue" : "Organizer"}`} />

        <PlaceEditForm
          initialData={{ type: placeType }}
          placeType={placeType}
          mode="create"
          showScraperFields
          onSubmit={handleCreateSubmit}
          onCancel={handleBack}
          isSubmitting={
            createPlaceMutation.isPending || upsertPlaceScraperMutation.isPending
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <BackButtonHeader backHref="/admin" title={title} className="min-w-0" />
        <Button onClick={() => setViewMode("create")}>
          <Plus className="mr-2 h-4 w-4" />
          <span className="sm:hidden">Add</span>
          <span className="hidden sm:inline">Add {isVenue ? "Venue" : "Organizer"}</span>
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={`Search ${itemLabel}s...`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="space-y-3">
        {filteredPlaces?.map((place) => (
          <Link
            key={place.id}
            href={`/admin/${itemLabel}/${place.id}`}
            className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card className="transition-colors hover:bg-accent/40">
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-4">
                  {place.logoImageUrl ? (
                    <div className="relative h-12 w-12 overflow-hidden rounded-md border">
                      <img
                        src={place.logoImageUrl}
                        alt={place.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted">
                      <TypeIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <div className="font-medium">{place.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {place.city || "No City"}, {place.state || "No State"}
                    </div>
                  </div>
                </div>

                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}

        {!filteredPlaces?.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No {itemLabel}s found
          </p>
        )}
      </div>
    </div>
  );
}
