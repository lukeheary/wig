"use client";

import { useParams } from "next/navigation";
import { PlaceManagementPage } from "@/components/places/place-management-page";

export default function AdminManageOrganizerPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <PlaceManagementPage
      placeId={id}
      expectedType="organizer"
      backHref="/admin/organizers"
      notFoundHref="/admin/organizers"
      notFoundLabel="Back to Organizers"
      forceCanManageMembers
    />
  );
}
