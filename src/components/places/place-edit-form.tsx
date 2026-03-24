"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building, Building2, Loader2 } from "lucide-react";
import { S3Uploader } from "@/components/ui/s3-uploader";
import { GooglePlacesAutocomplete } from "@/components/google-places-autocomplete";
import { CategoryMultiSelect } from "@/components/category-multi-select";
import { SlugInstagramInput } from "@/components/slug-instagram-input";
import {
  VenueHoursEditor,
  type VenueHours,
} from "@/components/venue-hours-editor";

export type PlaceType = "venue" | "organizer";
export type ScraperType = "dice" | "posh" | "clubcafe" | "ticketmaster";

export interface PlaceFormData {
  type: PlaceType;
  slug: string;
  name: string;
  description: string;
  logoImageUrl: string;
  coverImageUrl: string;
  address: string;
  city: string;
  state: string;
  website: string;
  instagram: string;
  latitude: number | null;
  longitude: number | null;
  hours: VenueHours | null;
  categories: string[];
  scraper: ScraperType | null;
  scraperSearchString: string;
  scraperClassificationName: string;
}

interface PlaceEditFormProps {
  initialData?: Partial<PlaceFormData>;
  placeType: PlaceType;
  placeId?: string; // Required for edit mode to upload to correct S3 path
  mode: "create" | "edit";
  onDeferredLogoFileChange?: (file: File | null) => void;
  onSubmit: (data: PlaceFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  showCard?: boolean;
  showScraperFields?: boolean;
}

const emptyFormData: PlaceFormData = {
  type: "venue",
  slug: "",
  name: "",
  description: "",
  logoImageUrl: "",
  coverImageUrl: "",
  address: "",
  city: "",
  state: "",
  website: "",
  instagram: "",
  latitude: null,
  longitude: null,
  hours: null,
  categories: [],
  scraper: null,
  scraperSearchString: "",
  scraperClassificationName: "",
};

export function PlaceEditForm({
  initialData,
  placeType,
  placeId,
  mode,
  onDeferredLogoFileChange,
  onSubmit,
  onCancel,
  isSubmitting,
  showCard = true,
  showScraperFields = false,
}: PlaceEditFormProps) {
  const initialDataVersion = useMemo(
    () =>
      JSON.stringify({
        type: placeType,
        slug: initialData?.slug ?? "",
        name: initialData?.name ?? "",
        description: initialData?.description ?? "",
        logoImageUrl: initialData?.logoImageUrl ?? "",
        coverImageUrl: initialData?.coverImageUrl ?? "",
        address: initialData?.address ?? "",
        city: initialData?.city ?? "",
        state: initialData?.state ?? "",
        website: initialData?.website ?? "",
        instagram: initialData?.instagram ?? "",
        latitude: initialData?.latitude ?? null,
        longitude: initialData?.longitude ?? null,
        hours: initialData?.hours ?? null,
        categories: initialData?.categories ?? [],
        scraper: initialData?.scraper ?? null,
        scraperSearchString: initialData?.scraperSearchString ?? "",
        scraperClassificationName: initialData?.scraperClassificationName ?? "",
      }),
    [initialData, placeType]
  );

  const [formData, setFormData] = useState<PlaceFormData>({
    ...emptyFormData,
    type: placeType,
    ...initialData,
  });

  const [placeSearch, setPlaceSearch] = useState(initialData?.name || "");
  const [googlePlaceName, setGooglePlaceName] = useState(
    initialData?.name || ""
  );
  const [nameOverride, setNameOverride] = useState("");
  const [isSlugSynced, setIsSlugSynced] = useState(
    (initialData?.slug || "") === (initialData?.instagram || "")
  );

  // Update form when initialData changes
  useEffect(() => {
    if (initialData) {
      setFormData({
        ...emptyFormData,
        type: placeType,
        ...initialData,
      });
      setPlaceSearch(initialData.name || "");
      setGooglePlaceName(initialData.name || "");
      setNameOverride("");
      setIsSlugSynced(
        (initialData.slug || "") === (initialData.instagram || "")
      );
    }
  }, [initialDataVersion, placeType]);

  const handlePlaceSelect = useCallback(
    (place: {
      name: string;
      address: string;
      city: string;
      state: string;
      formattedAddress: string;
      website?: string;
      latitude?: number;
      longitude?: number;
      openingHours?: google.maps.places.PlaceOpeningHours;
    }) => {
      // Generate slug from place name
      const slug = place.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      // Convert Google opening_hours to our VenueHours format
      let hours: VenueHours | null = null;
      if (place.openingHours?.periods) {
        const dayMap: Record<number, string> = {
          0: "sunday",
          1: "monday",
          2: "tuesday",
          3: "wednesday",
          4: "thursday",
          5: "friday",
          6: "saturday",
        };

        const formatGoogleTime = (time: string) => {
          // Google returns "HHMM", we need "HH:MM"
          return `${time.slice(0, 2)}:${time.slice(2)}`;
        };

        // Check if open 24/7 (single period with open day 0, time 0000, no close)
        const is24_7 =
          place.openingHours.periods.length === 1 &&
          place.openingHours.periods[0].open?.time === "0000" &&
          !place.openingHours.periods[0].close;

        if (is24_7) {
          hours = {};
          for (let i = 0; i < 7; i++) {
            (hours as any)[dayMap[i]] = {
              open: "00:00",
              close: "23:59",
              closed: false,
            };
          }
        } else {
          hours = {};
          // Initialize all days as closed
          for (let i = 0; i < 7; i++) {
            (hours as any)[dayMap[i]] = {
              open: "09:00",
              close: "17:00",
              closed: true,
            };
          }
          // Fill in open days from periods
          for (const period of place.openingHours.periods) {
            const dayNum = period.open?.day;
            if (dayNum == null) continue;
            const dayName = dayMap[dayNum];
            if (!dayName) continue;

            const openTime = period.open?.time
              ? formatGoogleTime(period.open.time)
              : "09:00";
            const closeTime = period.close?.time
              ? formatGoogleTime(period.close.time)
              : "23:59";

            (hours as any)[dayName] = {
              open: openTime,
              close: closeTime,
              closed: false,
            };
          }
        }
      }

      setFormData((prev) => ({
        ...prev,
        slug: slug.length >= 3 ? slug : `${prev.type}-${slug}`,
        name: nameOverride.trim() || place.name,
        address: place.address,
        city: place.city,
        state: place.state,
        website: place.website ?? prev.website,
        latitude: place.latitude || null,
        longitude: place.longitude || null,
        hours: hours ?? prev.hours,
        instagram: isSlugSynced
          ? (slug.length >= 3 ? slug : `${prev.type}-${slug}`).replace(/-/g, "")
          : prev.instagram,
      }));
      setGooglePlaceName(place.name);
      setPlaceSearch(place.name);
    },
    [isSlugSynced, nameOverride]
  );

  const handleCitySelect = useCallback(
    (place: {
      name: string;
      address: string;
      city: string;
      state: string;
      formattedAddress: string;
      latitude?: number;
      longitude?: number;
    }) => {
      setFormData((prev) => ({
        ...prev,
        city: place.city,
        state: place.state,
        latitude: place.latitude ?? null,
        longitude: place.longitude ?? null,
      }));
      setPlaceSearch(place.city);
    },
    []
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleNameOverrideChange = useCallback(
    (value: string) => {
      setNameOverride(value);
      const trimmed = value.trim();
      setFormData((prev) => ({
        ...prev,
        name: trimmed || googlePlaceName,
      }));
    },
    [googlePlaceName]
  );

  const isVenue = placeType === "venue";
  const typeLabel = isVenue ? "Venue" : "Organizer";
  const shouldDeferLogoUpload = mode === "create" || !placeId;

  const isFormValid =
    formData.slug &&
    formData.name &&
    (!isVenue || (formData.city && formData.state)) &&
    (!showScraperFields ||
      !formData.scraper ||
      formData.scraperSearchString.trim().length > 0);

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Google Places Search (for venues) */}
      {isVenue && (
        <div>
          <Label htmlFor="place-search">Search {typeLabel}</Label>
          <GooglePlacesAutocomplete
            value={placeSearch}
            onChange={setPlaceSearch}
            onPlaceSelect={handlePlaceSelect}
            placeholder={`Search for a ${typeLabel.toLowerCase()} (e.g. Big Night Live Boston)...`}
            searchType="establishment"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Start typing the {typeLabel.toLowerCase()} name to auto-fill details
          </p>
          <div className="mt-3">
            <Label htmlFor="place-name-override">
              Name Override (Optional)
            </Label>
            <Input
              id="place-name-override"
              placeholder="House of Blues"
              value={nameOverride}
              onChange={(e) => handleNameOverrideChange(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Saved display name:{" "}
              <span className="font-medium text-foreground">
                {formData.name || "Not set"}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Slug & Instagram */}
      <SlugInstagramInput
        slug={formData.slug}
        instagram={formData.instagram}
        onSlugChange={(slug) => setFormData({ ...formData, slug })}
        onInstagramChange={(instagram) =>
          setFormData({ ...formData, instagram })
        }
        onBothChange={(slug, instagram) =>
          setFormData({ ...formData, slug, instagram })
        }
        isSynced={isSlugSynced}
        onSyncedChange={setIsSlugSynced}
        slugPlaceholder={isVenue ? "big-night-live" : "after-brunch"}
        idPrefix="place"
      />

      {/* Name */}
      {!isVenue && (
        <div>
          <Label htmlFor="place-name">Name *</Label>
          <Input
            id="place-name"
            placeholder="After Brunch"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
        </div>
      )}

      {/* Profile Image */}
      <div>
        <Label>{typeLabel} Profile Image</Label>
        <S3Uploader
          folder={placeId ? `places/${placeId}` : "places"}
          fileName="logo-image.png"
          currentImageUrl={formData.logoImageUrl}
          deferUpload={shouldDeferLogoUpload}
          onDeferredFileChange={onDeferredLogoFileChange}
          onUploadComplete={(url) =>
            setFormData((prev) => ({ ...prev, logoImageUrl: url }))
          }
          onRemoveImage={() =>
            setFormData((prev) => ({ ...prev, logoImageUrl: "" }))
          }
          aspectRatio="square"
          className={"w-48"}
        />
      </div>

      {/* Description */}
      <div>
        <Label htmlFor="place-description">Description</Label>
        <Textarea
          id="place-description"
          placeholder={
            isVenue
              ? "Boston's premier concert venue..."
              : "Boston's premier social events..."
          }
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
          }
          rows={4}
        />
      </div>

      {/* Address & Location */}
      {isVenue ? (
        <>
          <div>
            <Label htmlFor="place-address">Address</Label>
            <Input
              id="place-address"
              placeholder="110 Causeway St"
              value={formData.address}
              onChange={(e) =>
                setFormData({ ...formData, address: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="place-city">City *</Label>
              <Input
                id="place-city"
                placeholder="Boston"
                value={formData.city}
                onChange={(e) =>
                  setFormData({ ...formData, city: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="place-state">State *</Label>
              <Input
                id="place-state"
                placeholder="MA"
                maxLength={2}
                value={formData.state}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    state: e.target.value.toUpperCase(),
                  })
                }
              />
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="place-city">City</Label>
          <GooglePlacesAutocomplete
            value={placeSearch}
            onChange={setPlaceSearch}
            onPlaceSelect={handleCitySelect}
            placeholder="Search for organizer city..."
            searchType="cities"
          />
          {formData.city && formData.state && (
            <p className="text-xs text-muted-foreground">
              Selected: {formData.city}, {formData.state}
            </p>
          )}
        </div>
      )}

      {/* Website */}
      <div>
        <Label htmlFor="place-website">Website</Label>
        <Input
          id="place-website"
          placeholder={
            isVenue ? "https://bignightlive.com" : "https://example.com"
          }
          value={formData.website}
          onChange={(e) =>
            setFormData({ ...formData, website: e.target.value })
          }
        />
      </div>

      {/* Venue-specific fields */}
      {isVenue && (
        <>
          <VenueHoursEditor
            hours={formData.hours}
            onChange={(hours) => setFormData({ ...formData, hours })}
          />
        </>
      )}

      <div>
        <Label>Categories</Label>
        <CategoryMultiSelect
          value={formData.categories}
          onChange={(categories) => setFormData({ ...formData, categories })}
          placeholder="Select categories..."
        />
      </div>

      {showScraperFields && (
        <div id="scraper-settings" className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">Scraper (Optional)</p>
          <div>
            <Label>Scraper Type</Label>
            <Select
              value={formData.scraper ?? "none"}
              onValueChange={(value) =>
                setFormData({
                  ...formData,
                  scraper: value === "none" ? null : (value as ScraperType),
                  scraperClassificationName:
                    value === "ticketmaster"
                      ? formData.scraperClassificationName
                      : "",
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="No scraper" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No scraper</SelectItem>
                <SelectItem value="dice">Dice.fm</SelectItem>
                <SelectItem value="posh">Posh</SelectItem>
                <SelectItem value="clubcafe">Club Cafe</SelectItem>
                <SelectItem value="ticketmaster">Ticketmaster</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {formData.scraper && (
            <div>
              <Label htmlFor="place-scraper-search-string">Search String</Label>
              <Input
                id="place-scraper-search-string"
                value={formData.scraperSearchString}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    scraperSearchString: e.target.value,
                  })
                }
                placeholder={
                  formData.scraper === "ticketmaster"
                    ? "Venue/organizer name (e.g. Big Night Live)"
                    : formData.scraper === "posh"
                      ? "Posh event or group URL(s)"
                      : "Scraper URL"
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Use a URL for URL-based scrapers, or plain text for text-based
                scrapers.
              </p>
            </div>
          )}
          {formData.scraper === "ticketmaster" && (
            <div>
              <Label htmlFor="place-scraper-classification-name">
                Classification Name
              </Label>
              <Input
                id="place-scraper-classification-name"
                value={formData.scraperClassificationName}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    scraperClassificationName: e.target.value,
                  })
                }
                placeholder="music"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Optional Ticketmaster classification filter, like
                <span className="font-mono"> music</span>.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Submit Buttons */}
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting || !isFormValid}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "edit" ? "Update" : "Create"} {typeLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );

  if (showCard) {
    return (
      <Card>
        <CardContent className="pt-6">{formContent}</CardContent>
      </Card>
    );
  }

  return formContent;
}
