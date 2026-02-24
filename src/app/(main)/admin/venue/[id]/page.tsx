"use client";

import { useParams } from "next/navigation";
import { PlaceManagementPage } from "@/components/places/place-management-page";

export default function AdminManageVenuePage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <PlaceManagementPage
      placeId={id}
      expectedType="venue"
      backHref="/admin/venues"
      notFoundHref="/admin/venues"
      notFoundLabel="Back to Venues"
      forceCanManageMembers
    />
  );
}
