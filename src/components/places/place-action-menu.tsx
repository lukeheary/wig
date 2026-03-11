"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarPlus, Edit, MoreHorizontal, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildReturnTo, withReturnTo } from "@/lib/navigation";

type PlaceActionMenuProps = {
  placeId: string;
  slug: string;
  type: "venue" | "organizer";
};

export function PlaceActionMenu({
  placeId,
  slug,
  type,
}: PlaceActionMenuProps) {
  const pathname = usePathname();
  const returnTo = buildReturnTo(pathname, null);
  const typeLabel = type === "venue" ? "Venue" : "Organizer";
  const queryKey = type === "venue" ? "venueId" : "organizerId";

  const editHref = withReturnTo(`/${type}/${slug}/edit`, returnTo);
  const createEventHref = withReturnTo(`/event/new?${queryKey}=${placeId}`, returnTo);
  const createEventSeriesHref = withReturnTo(
    `/event/new?recurring=true&${queryKey}=${placeId}`,
    returnTo
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="secondary" className="h-10 w-10">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">{typeLabel} actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link href={editHref}>
            <Edit className="h-4 w-4" />
            Edit {typeLabel}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={createEventHref}>
            <CalendarPlus className="h-4 w-4" />
            Create Event
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={createEventSeriesHref}>
            <Repeat className="h-4 w-4" />
            Create Event Series
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
