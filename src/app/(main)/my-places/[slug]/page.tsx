"use client";

import { useParams } from "next/navigation";
import { PlaceManagementPage } from "@/components/places/place-management-page";

export default function ManagePlacePage() {
  const params = useParams();
  const slug = params.slug as string;

  return (
    <PlaceManagementPage
      placeSlug={slug}
      notFoundHref="/my-places"
      notFoundLabel="Back to My Places"
    />
  );
}
