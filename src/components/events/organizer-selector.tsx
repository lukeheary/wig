"use client";

import { useState } from "react";
import { Search, Loader2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface OrganizerData {
  id: string;
  name: string;
  city?: string;
  state?: string;
  slug?: string;
  instagram?: string;
}

interface OrganizerSelectorProps {
  selectedOrganizer: OrganizerData | null;
  onOrganizerSelect: (organizer: OrganizerData | null) => void;
}

export function OrganizerSelector({
  selectedOrganizer,
  onOrganizerSelect,
}: OrganizerSelectorProps) {
  const [organizerSearch, setOrganizerSearch] = useState("");
  const [isOrganizerPopoverOpen, setIsOrganizerPopoverOpen] = useState(false);

  const { data: searchResults, isLoading: isSearchingOrganizers } =
    trpc.place.searchPlaces.useQuery(
      { query: organizerSearch, type: "organizer" },
      { enabled: organizerSearch.length > 2 }
    );

  const clearSelection = () => {
    onOrganizerSelect(null);
  };

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <Label className="text-xl font-semibold md:text-2xl">
          Organizer
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            Optional
          </span>
        </Label>
      </div>

      <div className="space-y-4">
        <Popover
          open={isOrganizerPopoverOpen}
          onOpenChange={setIsOrganizerPopoverOpen}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={isOrganizerPopoverOpen}
              className="h-12 w-full justify-between"
            >
              {selectedOrganizer?.id
                ? selectedOrganizer.name
                : "Search for an organizer..."}
              <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
            <div className="flex flex-col">
              <div className="flex items-center border-b px-3 py-2">
                <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                <input
                  className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Type to search organizers..."
                  value={organizerSearch}
                  onChange={(e) => setOrganizerSearch(e.target.value)}
                />
              </div>
              <div className="max-h-[300px] overflow-auto p-1">
                {isSearchingOrganizers && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                )}
                {!isSearchingOrganizers &&
                  searchResults?.map((organizer: any) => (
                    <button
                      key={organizer.id}
                      type="button"
                      className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        onOrganizerSelect({
                          id: organizer.id,
                          name: organizer.name,
                          city: organizer.city || "",
                          state: organizer.state || "",
                          slug: organizer.slug,
                          instagram: organizer.instagram || "",
                        });
                        setIsOrganizerPopoverOpen(false);
                        setOrganizerSearch("");
                      }}
                    >
                      <div className="font-medium">{organizer.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {organizer.city || "No city"}
                        {organizer.state ? `, ${organizer.state}` : ""}
                      </div>
                    </button>
                  ))}
                {!isSearchingOrganizers &&
                  organizerSearch.length > 2 &&
                  searchResults?.length === 0 && (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      No organizers found for &quot;{organizerSearch}&quot;
                    </div>
                  )}
                {organizerSearch.length <= 2 && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    Type at least 3 characters...
                  </div>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {selectedOrganizer?.id && (
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
              {selectedOrganizer.name}
            </div>
            <div className="text-muted-foreground">
              {selectedOrganizer.city || selectedOrganizer.state ? (
                <div>
                  {selectedOrganizer.city || "No city"}
                  {selectedOrganizer.state ? `, ${selectedOrganizer.state}` : ""}
                </div>
              ) : (
                <div>No location set</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
