"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, Loader2, X, Plus, ArrowLeft } from "lucide-react";
import { GooglePlacesAutocomplete } from "@/components/google-places-autocomplete";
import { SlugInstagramInput } from "@/components/slug-instagram-input";
import type { VenueHours } from "@/components/venue-hours-editor";

export interface VenueData {
  id?: string;
  name: string;
  address?: string;
  city: string;
  state: string;
  latitude?: number;
  longitude?: number;
  slug?: string;
  instagram?: string;
  categories?: string[];
  hours?: VenueHours | null;
}

interface VenueSelectorProps {
  selectedVenue: VenueData | null;
  onVenueSelect: (venue: VenueData | null) => void;
  isCreatingNew: boolean;
  setIsCreatingNew: (isCreating: boolean) => void;
  errors?: {
    venueName?: string;
    city?: string;
    state?: string;
    slug?: string;
  };
}

export function VenueSelector({
  selectedVenue,
  onVenueSelect,
  isCreatingNew,
  setIsCreatingNew,
  errors,
}: VenueSelectorProps) {
  const [venueSearch, setVenueSearch] = useState("");
  const [isVenuePopoverOpen, setIsVenuePopoverOpen] = useState(false);
  const [googlePlacesInput, setGooglePlacesInput] = useState("");
  const [isSlugSynced, setIsSlugSynced] = useState(true);

  const { data: searchResults, isLoading: isSearchingVenues } =
    trpc.place.searchPlaces.useQuery(
      { query: venueSearch, type: "venue" },
      { enabled: venueSearch.length > 2 }
    );

  const handleAddNewVenue = () => {
    setIsCreatingNew(true);
    setIsVenuePopoverOpen(false);
    setGooglePlacesInput("");
    setIsSlugSynced(true);
    onVenueSelect(null);
  };

  const handleBackToSearch = () => {
    setIsCreatingNew(false);
    setGooglePlacesInput("");
    setIsSlugSynced(true);
    onVenueSelect(null);
  };

  const handleGooglePlaceSelect = (place: {
    name: string;
    address: string;
    city: string;
    state: string;
    formattedAddress: string;
    latitude?: number;
    longitude?: number;
  }) => {
    // Generate slug from venue name
    const slug = place.name.toLowerCase().replace(/[^a-z0-9]+/g, "");

    onVenueSelect({
      name: place.name,
      address: place.address,
      city: place.city,
      state: place.state,
      latitude: place.latitude,
      longitude: place.longitude,
      slug: slug.length >= 3 ? slug : `venue${slug}`,
      instagram: slug.length >= 3 ? slug : `venue${slug}`,
    });
    setGooglePlacesInput(place.name);
  };

  const clearSelection = () => {
    onVenueSelect(null);
    setGooglePlacesInput("");
    setIsSlugSynced(true);
  };

  const showNoResults =
    !isSearchingVenues && venueSearch.length > 2 && searchResults?.length === 0;

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <Label className="text-xl font-semibold md:text-2xl">Venue</Label>
        {isCreatingNew && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleBackToSearch}
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Search
          </Button>
        )}
      </div>

      {!isCreatingNew ? (
        <div className="space-y-4">
          <Popover
            open={isVenuePopoverOpen}
            onOpenChange={setIsVenuePopoverOpen}
          >
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={isVenuePopoverOpen}
                className="bg-text-muted-foreground h-12 w-full justify-between"
              >
                {selectedVenue?.id
                  ? selectedVenue.name
                  : "Search for a venue..."}
                <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
              <div className="flex flex-col">
                <div className="flex items-center border-b px-3 py-2">
                  <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                  <input
                    className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Type to search venues..."
                    value={venueSearch}
                    onChange={(e) => setVenueSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-[300px] overflow-auto p-1">
                  {isSearchingVenues && (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  )}
                  {!isSearchingVenues &&
                    searchResults?.map((v: any) => (
                      <button
                        key={v.id}
                        type="button"
                        className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            onVenueSelect({
                              id: v.id,
                              name: v.name,
                              address: v.address || "",
                              city: v.city || "",
                              state: v.state || "",
                              slug: v.slug,
                              instagram: v.instagram || "",
                              categories: v.categories || [],
                              hours: (v.hours as VenueHours) || null,
                            });
                            setIsVenuePopoverOpen(false);
                            setVenueSearch("");
                          }}
                      >
                        <div className="font-medium">{v.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {v.city}, {v.state}
                        </div>
                      </button>
                    ))}
                  {showNoResults && (
                    <div className="py-4 text-center">
                      <p className="mb-3 text-sm text-muted-foreground">
                        No venues found for &quot;{venueSearch}&quot;
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAddNewVenue}
                        className="gap-1"
                      >
                        <Plus className="h-4 w-4" />
                        Add New Venue
                      </Button>
                    </div>
                  )}
                  {venueSearch.length <= 2 && (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      Type at least 3 characters...
                    </div>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {selectedVenue?.id && (
            <div className="relative rounded-md bg-background p-4 text-sm shadow-sm ring-1 ring-border">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-3 top-3 h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={clearSelection}
              >
                <X className="h-4 w-4" />
              </Button>
              <div className="font-semibold text-primary">
                {selectedVenue.name}
              </div>
              <div className="text-muted-foreground">
                {selectedVenue.address && (
                  <div className="flex items-center gap-1">
                    {selectedVenue.address}
                  </div>
                )}
                <div>
                  {selectedVenue.city}, {selectedVenue.state}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {!selectedVenue ? (
            <div className="space-y-2">
              <Label>Search for a place</Label>
              <GooglePlacesAutocomplete
                value={googlePlacesInput}
                onChange={setGooglePlacesInput}
                onPlaceSelect={handleGooglePlaceSelect}
                placeholder="Search Google Places..."
                searchType="establishment"
              />
              <p className="text-xs text-muted-foreground">
                Search for a venue using Google Places
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative rounded-md bg-background p-4 text-sm shadow-sm ring-1 ring-border">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-3 top-3 h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={clearSelection}
                >
                  <X className="h-4 w-4" />
                </Button>
                <div className="font-semibold text-primary">
                  {selectedVenue.name}
                </div>
                <div className="text-muted-foreground">
                  {selectedVenue.address && <div>{selectedVenue.address}</div>}
                  <div>
                    {selectedVenue.city}, {selectedVenue.state}
                  </div>
                </div>
              </div>

              {/* Editable fields for fine-tuning */}
              <div className="space-y-3">
                <SlugInstagramInput
                  slug={selectedVenue.slug || ""}
                  instagram={selectedVenue.instagram || ""}
                  onSlugChange={(slug) =>
                    onVenueSelect({ ...selectedVenue, slug })
                  }
                  onInstagramChange={(instagram) =>
                    onVenueSelect({ ...selectedVenue, instagram })
                  }
                  onBothChange={(slug, instagram) =>
                    onVenueSelect({ ...selectedVenue, slug, instagram })
                  }
                  isSynced={isSlugSynced}
                  onSyncedChange={setIsSlugSynced}
                  slugPlaceholder="venuename"
                  idPrefix="venue"
                  error={errors?.slug}
                />

                <div className="space-y-2">
                  <Label htmlFor="venueName">Venue Name</Label>
                  <Input
                    id="venueName"
                    value={selectedVenue.name}
                    onChange={(e) =>
                      onVenueSelect({
                        ...selectedVenue,
                        name: e.target.value,
                      })
                    }
                    className={errors?.venueName ? "border-destructive" : ""}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Street Address</Label>
                  <Input
                    id="address"
                    value={selectedVenue.address || ""}
                    onChange={(e) =>
                      onVenueSelect({
                        ...selectedVenue,
                        address: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={selectedVenue.city}
                      onChange={(e) =>
                        onVenueSelect({
                          ...selectedVenue,
                          city: e.target.value,
                        })
                      }
                      className={errors?.city ? "border-destructive" : ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Input
                      id="state"
                      value={selectedVenue.state}
                      onChange={(e) =>
                        onVenueSelect({
                          ...selectedVenue,
                          state: e.target.value,
                        })
                      }
                      className={errors?.state ? "border-destructive" : ""}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
