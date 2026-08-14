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
  const [deferredLogoFile, setDeferredLogoFile] = useState<File | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

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
  const updatePlaceMutation = trpc.place.updatePlace.useMutation();
  const replacePlaceScrapersMutation =
    trpc.admin.replacePlaceScrapers.useMutation();

  const uploadPlaceLogo = async (placeId: string, file: File) => {
    const uploadFormData = new FormData();
    uploadFormData.append("file", file);
    uploadFormData.append("folder", `places/${placeId}/logos`);
    uploadFormData.append("filename", "logo-image.png");

    const response = await fetch("/api/upload", {
      method: "POST",
      body: uploadFormData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to upload logo");
    }

    return data.url as string;
  };

  const handleBack = () => {
    setViewMode("list");
    setDeferredLogoFile(null);
  };

  const handleCreateSubmit = async (formData: PlaceFormData) => {
    try {
      const { scrapers, isEnabled: _isEnabled, ...placeData } = formData;

      const createdPlace = await createPlaceMutation.mutateAsync({
        ...placeData,
        logoImageUrl: "",
        latitude: placeData.latitude ?? undefined,
        longitude: placeData.longitude ?? undefined,
      });

      let logoWarning: string | null = null;
      if (deferredLogoFile) {
        setIsUploadingLogo(true);
        try {
          const logoImageUrl = await uploadPlaceLogo(
            createdPlace.id,
            deferredLogoFile
          );
          await updatePlaceMutation.mutateAsync({
            placeId: createdPlace.id,
            logoImageUrl,
          });
        } catch (error) {
          logoWarning =
            error instanceof Error ? error.message : "Failed to upload logo";
        } finally {
          setIsUploadingLogo(false);
        }
      }

      let scraperWarning: string | null = null;
      try {
        await replacePlaceScrapersMutation.mutateAsync({
          placeId: createdPlace.id,
          scrapers,
        });
      } catch (error) {
        scraperWarning =
          error instanceof Error ? error.message : "Failed to save scraper";
      }

      const placeLabel = placeType === "venue" ? "Venue" : "Organizer";
      const warnings = [
        logoWarning && `logo upload failed: ${logoWarning}`,
        scraperWarning && `scraper setup failed: ${scraperWarning}`,
      ].filter(Boolean);

      toast({
        title: "Success",
        description:
          warnings.length > 0
            ? `${placeLabel} created, but ${warnings.join("; ")}`
            : `${placeLabel} created successfully`,
      });

      setDeferredLogoFile(null);
      setViewMode("list");
      await utils.admin.listAllPlaces.invalidate({ type: placeType });
      await utils.admin.listScrapers.invalidate();
    } catch (error) {
      setIsUploadingLogo(false);
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
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );

  const isVenue = placeType === "venue";
  const title = isVenue ? "Venues" : "Organizers";
  const itemLabel = isVenue ? "venue" : "organizer";
  const TypeIcon = isVenue ? Building : Building2;

  if (viewMode === "create") {
    return (
      <div className="space-y-6">
        <BackButtonHeader
          onBack={handleBack}
          title={`Create ${isVenue ? "Venue" : "Organizer"}`}
        />

        <PlaceEditForm
          initialData={{ type: placeType }}
          placeType={placeType}
          mode="create"
          onDeferredLogoFileChange={setDeferredLogoFile}
          showScraperFields
          onSubmit={handleCreateSubmit}
          onCancel={handleBack}
          isSubmitting={
            createPlaceMutation.isPending ||
            updatePlaceMutation.isPending ||
            replacePlaceScrapersMutation.isPending ||
            isUploadingLogo
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <BackButtonHeader backHref="/admin" title={title} className="min-w-0" />
        <Button
          onClick={() => {
            setDeferredLogoFile(null);
            setViewMode("create");
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          <span className="sm:hidden">Add</span>
          <span className="hidden sm:inline">
            Add {isVenue ? "Venue" : "Organizer"}
          </span>
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
                    {!place.isEnabled && (
                      <div className="mt-1 text-xs font-medium text-muted-foreground">
                        Disabled
                      </div>
                    )}
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
