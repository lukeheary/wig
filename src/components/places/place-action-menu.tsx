"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarPlus,
  Edit,
  MoreHorizontal,
  Repeat,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { buildReturnTo, withReturnTo } from "@/lib/navigation";

type PlaceActionMenuProps = {
  placeId: string;
  slug: string;
  type: "venue" | "organizer";
  isAdmin?: boolean;
};

export function PlaceActionMenu({
  placeId,
  slug,
  type,
  isAdmin = false,
}: PlaceActionMenuProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
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
  const editScraperHref = withReturnTo(`/${type}/${slug}/edit#scraper-settings`, returnTo);

  const trigger = (
    <Button size="icon" variant="secondary" className="h-10 w-10">
      <MoreHorizontal className="h-4 w-4" />
      <span className="sr-only">{typeLabel} actions</span>
    </Button>
  );

  if (isDesktop) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem asChild>
            <Link href={editHref}>
              <Edit className="h-4 w-4" />
              Edit {typeLabel}
            </Link>
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem asChild>
              <Link href={editScraperHref}>
                <Search className="h-4 w-4" />
                Edit Scraper
              </Link>
            </DropdownMenuItem>
          )}
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

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="px-0 pb-8 pt-6 outline-none">
        <SheetHeader className="px-6 pb-4 text-left">
          <SheetTitle>{typeLabel} Actions</SheetTitle>
        </SheetHeader>
        <div className="px-2">
          <Link
            href={editHref}
            className="flex w-full items-center gap-3 rounded-lg px-4 py-5 transition-colors hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <Edit className="h-4 w-4" />
            Edit {typeLabel}
          </Link>
          {isAdmin && (
            <Link
              href={editScraperHref}
              className="flex w-full items-center gap-3 rounded-lg px-4 py-5 transition-colors hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              <Search className="h-4 w-4" />
              Edit Scraper
            </Link>
          )}
          <Link
            href={createEventHref}
            className="flex w-full items-center gap-3 rounded-lg px-4 py-5 transition-colors hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <CalendarPlus className="h-4 w-4" />
            Create Event
          </Link>
          <Link
            href={createEventSeriesHref}
            className="flex w-full items-center gap-3 rounded-lg px-4 py-5 transition-colors hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <Repeat className="h-4 w-4" />
            Create Event Series
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
