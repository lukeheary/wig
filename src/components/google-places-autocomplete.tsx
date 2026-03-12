"use client";

import { useRef, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { useLoadScript } from "@react-google-maps/api";

const libraries: "places"[] = ["places"];

interface PlaceResult {
  name: string;
  address: string;
  city: string;
  state: string;
  formattedAddress: string;
  website?: string;
  latitude?: number;
  longitude?: number;
  openingHours?: google.maps.places.PlaceOpeningHours;
}

interface GooglePlacesAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect: (place: PlaceResult) => void;
  placeholder?: string;
  className?: string;
  searchType?: "establishment" | "cities";
}

function AutocompleteInput({
  value,
  onChange,
  onPlaceSelect,
  placeholder,
  className,
  searchType = "establishment",
}: GooglePlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const onPlaceSelectRef = useRef(onPlaceSelect);
  
  useEffect(() => {
    onPlaceSelectRef.current = onPlaceSelect;
  }, [onPlaceSelect]);

  useEffect(() => {
    if (!inputRef.current || !(window as any).google) return;

    // Initialize autocomplete with different types based on searchType
    const types = searchType === "cities" ? ["(cities)"] : ["establishment"];

    // Clear any existing listeners on prior Autocomplete instance
    if (autocompleteRef.current) {
      try {
        // clear listeners to avoid duplicates when searchType changes
        (window as any).google.maps.event.clearInstanceListeners(
          autocompleteRef.current
        );
      } catch (err) {
        // ignore errors clearing listeners
      }
    }

    autocompleteRef.current = new (
      window as any
    ).google.maps.places.Autocomplete(inputRef.current, {
      types,
      componentRestrictions: { country: "us" },
      fields: [
        "address_components",
        "formatted_address",
        "name",
        "geometry",
        "opening_hours",
        "website",
      ],
    });

    // Add place changed listener
    const listener = autocompleteRef?.current?.addListener(
      "place_changed",
      () => {
        const place = autocompleteRef.current?.getPlace();

        if (!place || !place.address_components) {
          return;
        }

        // Extract address components
        let streetNumber = "";
        let route = "";
        let city = "";
        let state = "";

        place.address_components.forEach((component) => {
          const types = component.types;

          if (types.includes("street_number")) {
            streetNumber = component.long_name;
          }
          if (types.includes("route")) {
            route = component.long_name;
          }
          if (types.includes("locality")) {
            city = component.long_name;
          }
          if (types.includes("administrative_area_level_1")) {
            state = component.short_name;
          }
        });

        const address = `${streetNumber} ${route}`.trim();
        const formattedAddress = place.formatted_address || "";
        const name = place.name || "";

        // Extract latitude and longitude from geometry
        // Note: location.lat() and location.lng() are functions that return numbers
        let latitude: number | undefined;
        let longitude: number | undefined;

        if (place.geometry?.location) {
          const location = place.geometry.location as any;
          // Google Maps LatLng objects have lat() and lng() as methods
          latitude = typeof location.lat === 'function' ? location.lat() : location.lat;
          longitude = typeof location.lng === 'function' ? location.lng() : location.lng;
        }

        onPlaceSelectRef.current({
          name,
          address,
          city,
          state,
          formattedAddress,
          website: place.website || undefined,
          latitude,
          longitude,
          openingHours: place.opening_hours || undefined,
        });
      }
    );

    return () => {
      // remove the specific listener if possible
      try {
        if (listener && (window as any).google?.maps?.event?.removeListener) {
          (window as any).google.maps.event.removeListener(listener);
        }
      } catch (err) {
        // ignore removal errors
      }

      // clear any remaining listeners and null the autocomplete ref
      if (autocompleteRef.current) {
        try {
          (window as any).google.maps.event.clearInstanceListeners(
            autocompleteRef.current
          );
        } catch (err) {
          // ignore
        }
        autocompleteRef.current = null;
      }
    };
  }, [searchType]);

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  );
}

export function GooglePlacesAutocomplete(props: GooglePlacesAutocompleteProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey || "",
    libraries,
  });

  if (loadError) {
    console.error("Error loading Google Maps:", loadError);
    return (
      <Input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className={props.className}
      />
    );
  }

  if (!apiKey) {
    console.error("Google Maps API key is not set");
    return (
      <Input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className={props.className}
      />
    );
  }

  if (!isLoaded) {
    return (
      <Input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Loading..."
        className={props.className}
        disabled
      />
    );
  }

  return <AutocompleteInput {...props} />;
}
