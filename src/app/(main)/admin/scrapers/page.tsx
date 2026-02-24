"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlertCircle,
  Building,
  Calendar,
  CheckCircle2,
  Download,
  ExternalLink,
  ImageIcon,
  Loader2,
  MapPin,
  Play,
  Search,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type ScraperType = "dice" | "posh" | "clubcafe" | "ticketmaster";

interface ScraperRow {
  id: string;
  placeId: string;
  scraper: ScraperType;
  searchString: string;
  createdAt: Date;
  updatedAt: Date;
  place: {
    id: string;
    type: "venue" | "organizer";
    name: string;
    city: string | null;
    state: string | null;
  };
}

interface ScrapedEvent {
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  eventUrl: string | null;
  externalId: string | null;
  startAt: string;
  endAt: string | null;
  venueName: string;
  address: string;
  city: string;
  state: string;
  categories: string[];
  visibility: string;
  source: string;
  eventStatus: string;
}

interface EditableScrapedEvent extends ScrapedEvent {
  editableStartAt: string;
  editableEndAt: string;
  venueId?: string | null;
  linkedVenue?: SelectedVenue | null;
}

interface SelectedVenue {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

interface ScrapeResult {
  venue?: {
    id?: string;
    name: string;
    address: string;
    city: string;
    state: string;
  };
  organizer?: {
    name: string;
    url?: string;
  } | null;
  events: ScrapedEvent[];
  totalEvents: number;
  errors?: { url: string; error: string }[];
}

const SCRAPER_LABELS: Record<ScraperType, string> = {
  dice: "Dice.fm",
  posh: "Posh",
  clubcafe: "Club Cafe",
  ticketmaster: "Ticketmaster",
};

function formatDateTimeLabel(value: string | null) {
  if (!value) return "Unknown time";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, "EEE, MMM d yyyy 'at' h:mm a");
}

function toDateTimeLocalInput(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function VenueDropdown({
  selected,
  onSelect,
  placeholder = "Link to a venue (optional)",
}: {
  selected: SelectedVenue | null;
  onSelect: (venue: SelectedVenue | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: results, isLoading } = trpc.place.searchPlaces.useQuery(
    { query: search, type: "venue" },
    { enabled: search.length > 1 }
  );

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <Building className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{selected.name}</span>
        {selected.city && selected.state && (
          <span className="text-muted-foreground">
            {selected.city}, {selected.state}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => onSelect(null)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between text-muted-foreground"
          size="sm"
        >
          <span className="flex items-center gap-2">
            <Building className="h-4 w-4" />
            {placeholder}
          </span>
          <Search className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            className="flex h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search venues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-[220px] overflow-auto p-1">
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {!isLoading &&
            results?.map((venue) => (
              <button
                key={venue.id}
                type="button"
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onSelect({
                    id: venue.id,
                    name: venue.name,
                    city: venue.city,
                    state: venue.state,
                  });
                  setOpen(false);
                  setSearch("");
                }}
              >
                <div className="font-medium">{venue.name}</div>
                {venue.city && venue.state && (
                  <div className="text-xs text-muted-foreground">
                    {venue.city}, {venue.state}
                  </div>
                )}
              </button>
            ))}
          {!isLoading && search.length > 1 && results?.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No venues found
            </p>
          )}
          {search.length <= 1 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Type at least 2 characters...
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EventCard({
  event,
  onUpdate,
  showVenueSelector,
  selectedVenue,
  onSelectVenue,
}: {
  event: EditableScrapedEvent;
  onUpdate: (patch: Partial<EditableScrapedEvent>) => void;
  showVenueSelector: boolean;
  selectedVenue: SelectedVenue | null;
  onSelectVenue: (venue: SelectedVenue | null) => void;
}) {
  const [showFullDesc, setShowFullDesc] = useState(false);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex gap-4">
          {event.coverImageUrl ? (
            <img
              src={event.coverImageUrl}
              alt={event.title}
              className="h-24 w-24 shrink-0 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md bg-muted">
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold leading-tight">{event.title}</h3>
              <a
                href={event.eventUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatDateTimeLabel(event.editableStartAt || event.startAt)}
              </span>
              {event.endAt && (
                <span className="text-xs">
                  Ends {formatDateTimeLabel(event.editableEndAt || event.endAt)}
                </span>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Start</p>
                <Input
                  type="datetime-local"
                  value={event.editableStartAt}
                  onChange={(e) => onUpdate({ editableStartAt: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">End</p>
                <Input
                  type="datetime-local"
                  value={event.editableEndAt}
                  onChange={(e) => onUpdate({ editableEndAt: e.target.value })}
                />
              </div>
            </div>

            {showVenueSelector && (
              <div className="space-y-1">
                {event.venueName && (
                  <p className="text-xs text-muted-foreground">
                    Scraped venue:
                    <span className="ml-1 font-medium text-foreground">
                      {event.venueName}
                    </span>
                  </p>
                )}
                <p className="text-xs font-medium text-muted-foreground">
                  Venue (optional)
                </p>
                <VenueDropdown
                  selected={selectedVenue}
                  onSelect={onSelectVenue}
                />
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {event.categories.map((cat) => (
                <Badge key={cat} variant="secondary" className="text-xs">
                  {cat}
                </Badge>
              ))}
              <Badge variant="outline" className="text-xs">
                {event.source}
              </Badge>
            </div>

            {event.description && (
              <p
                className={`text-sm text-muted-foreground ${!showFullDesc ? "line-clamp-2" : ""}`}
                onClick={() => setShowFullDesc(!showFullDesc)}
              >
                {event.description}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminScrapersPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedScraperId, setSelectedScraperId] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [editableEvents, setEditableEvents] = useState<EditableScrapedEvent[]>([]);
  const [defaultVenue, setDefaultVenue] = useState<SelectedVenue | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const resetScrapeSession = () => {
    setError(null);
    setResult(null);
    setEditableEvents([]);
    setDefaultVenue(null);
    setImportedCount(null);
  };

  const queryInput = useMemo(
    () => (search.trim().length > 0 ? { search: search.trim() } : undefined),
    [search]
  );

  const { data: scraperRows = [], isLoading } = trpc.admin.listScrapers.useQuery(
    queryInput
  );

  const batchCreate = trpc.event.batchCreateEvents.useMutation();

  useEffect(() => {
    if (scraperRows.length === 0) {
      setSelectedScraperId("");
      resetScrapeSession();
      return;
    }

    const stillExists = scraperRows.some((row) => row.id === selectedScraperId);
    if (!selectedScraperId || !stillExists) {
      setSelectedScraperId(scraperRows[0].id);
      resetScrapeSession();
    }
  }, [scraperRows, selectedScraperId]);

  const selectedRow = useMemo(
    () =>
      scraperRows.find((row) => row.id === selectedScraperId) as
        | ScraperRow
        | undefined,
    [scraperRows, selectedScraperId]
  );

  const runScraper = async () => {
    if (!selectedRow) return;

    setIsScraping(true);
    setError(null);
    setResult(null);
    setEditableEvents([]);
    setDefaultVenue(null);
    setImportedCount(null);

    try {
      let endpoint = "";
      let payload: Record<string, unknown> = {};

      if (selectedRow.scraper === "dice") {
        endpoint = "/api/scrape-dice";
        payload = { url: selectedRow.searchString };
      } else if (selectedRow.scraper === "clubcafe") {
        endpoint = "/api/scrape-clubcafe";
        payload = { url: selectedRow.searchString, maxPages: 3 };
      } else if (selectedRow.scraper === "posh") {
        endpoint = "/api/scrape-posh";
        const urls = selectedRow.searchString
          .split(/[\n,]+/)
          .map((value) => value.trim())
          .filter(Boolean);
        if (urls.length === 0) {
          throw new Error("This Posh scraper has an empty search string.");
        }
        payload = { urls };
      } else if (selectedRow.scraper === "ticketmaster") {
        endpoint = "/api/scrape-ticketmaster";
        if (!selectedRow.place.state) {
          throw new Error(
            "Ticketmaster scrapers require the linked venue to have a 2-letter state code."
          );
        }
        payload = {
          venueName: selectedRow.searchString,
          stateCode: selectedRow.place.state,
        };
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to scrape");
        return;
      }

      const nextResult = data as ScrapeResult;
      setResult(nextResult);
      setEditableEvents(
        nextResult.events.map((event) => ({
          ...event,
          editableStartAt: toDateTimeLocalInput(event.startAt),
          editableEndAt: toDateTimeLocalInput(event.endAt),
          venueId: null,
          linkedVenue: null,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setIsScraping(false);
    }
  };

  const handleImport = async () => {
    if (!result || !selectedRow || editableEvents.length === 0) return;

    const events = editableEvents.map((event) => {
      const startAt = new Date(event.editableStartAt || event.startAt);
      if (Number.isNaN(startAt.getTime())) {
        throw new Error(`Event "${event.title}" has an invalid start date/time.`);
      }

      const endAt = event.editableEndAt ? new Date(event.editableEndAt) : undefined;
      if (endAt && Number.isNaN(endAt.getTime())) {
        throw new Error(`Event "${event.title}" has an invalid end date/time.`);
      }

      return {
        title: event.title,
        description: event.description ?? undefined,
        coverImageUrl: event.coverImageUrl ?? undefined,
        eventUrl: event.eventUrl ?? undefined,
        source: event.source ?? undefined,
        externalId: event.externalId ?? undefined,
        startAt,
        endAt,
        address: event.address,
        city: event.city,
        state: event.state,
        venueId:
          selectedRow.place.type === "organizer"
            ? event.venueId ?? defaultVenue?.id ?? undefined
            : undefined,
        // Scrapers no longer auto-assign categories.
        categories: [],
        visibility: event.visibility as "public" | "private",
      };
    });

    try {
      const data = await batchCreate.mutateAsync({
        venueId: selectedRow.place.type === "venue" ? selectedRow.placeId : undefined,
        organizerId:
          selectedRow.place.type === "organizer" ? selectedRow.placeId : undefined,
        events,
      });
      setImportedCount(data.created);
      toast({
        title: "Events imported",
        description: `${data.created} events added to WIG (${selectedRow.place.name})`,
      });
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <BackButtonHeader
        backHref="/admin"
        title="Scrapers"
        subtitle="Run any configured scraper from one page"
      />

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search scraper rows by venue or search string..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading scrapers...
            </div>
          ) : scraperRows.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No scraper rows found. Configure one from{" "}
              <Link href="/admin/venues" className="font-medium underline">
                Admin Venues
              </Link>
              .
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium">Select scraper row</p>
                <Select
                  value={selectedScraperId}
                  onValueChange={(value) => {
                    setSelectedScraperId(value);
                    resetScrapeSession();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a scraper row" />
                  </SelectTrigger>
                  <SelectContent>
                    {scraperRows.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.place.name} - {SCRAPER_LABELS[row.scraper]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedRow && (
                <div className="space-y-3 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{selectedRow.place.name}</span>
                    <Badge variant="secondary">
                      {SCRAPER_LABELS[selectedRow.scraper]}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    Search string:
                    <span className="ml-1 font-mono text-xs text-foreground">
                      {selectedRow.searchString}
                    </span>
                  </p>
                  <Button onClick={runScraper} disabled={isScraping}>
                    {isScraping ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-4 w-4" />
                    )}
                    Run Scraper
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {result && selectedRow && (
        <>
          {result.venue && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <MapPin className="h-5 w-5" />
                  {result.venue.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {result.venue.address && <p>{result.venue.address}</p>}
                <p>
                  Parsed location:{" "}
                  <span className="font-medium text-foreground">
                    {result.venue.city}, {result.venue.state}
                  </span>
                </p>
              </CardContent>
            </Card>
          )}

          {result.organizer && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Building className="h-5 w-5" />
                  {result.organizer.name}
                </CardTitle>
              </CardHeader>
              {result.organizer.url && (
                <CardContent className="pt-0 text-sm text-muted-foreground">
                  <a
                    href={result.organizer.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {result.organizer.url}
                  </a>
                </CardContent>
              )}
            </Card>
          )}

          {result.errors && result.errors.length > 0 && (
            <Card className="border-yellow-500/60">
              <CardContent className="space-y-2 p-4 text-sm text-yellow-700">
                <div className="flex items-center gap-2 font-medium">
                  <AlertCircle className="h-4 w-4" />
                  {result.errors.length} URL(s) failed to scrape
                </div>
                <div className="space-y-1 text-xs">
                  {result.errors.map((issue, idx) => (
                    <p key={`${issue.url}-${idx}`}>
                      <span className="font-mono">{issue.url}</span>: {issue.error}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-4 p-4">
              <p className="text-sm text-muted-foreground">
                Import target {selectedRow.place.type}:
                <span className="ml-1 font-medium text-foreground">
                  {selectedRow.place.name}
                </span>
              </p>
              {selectedRow.place.type === "organizer" && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Default venue for scraped events
                  </p>
                  <VenueDropdown
                    selected={defaultVenue}
                    onSelect={setDefaultVenue}
                  />
                </div>
              )}
              <div className="flex items-center justify-between border-t pt-4">
                <p className="text-sm text-muted-foreground">
                  {editableEvents.length} events to import
                </p>
                {importedCount !== null ? (
                  <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    {importedCount} events imported
                  </div>
                ) : (
                  <Button
                    onClick={handleImport}
                    disabled={batchCreate.isPending}
                    size="sm"
                  >
                    {batchCreate.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Add All to WIG
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {editableEvents.map((event, idx) => (
              <EventCard
                key={`${event.externalId ?? event.title}-${idx}`}
                event={event}
                showVenueSelector={selectedRow.place.type === "organizer"}
                selectedVenue={event.linkedVenue ?? null}
                onSelectVenue={(venue) => {
                  setEditableEvents((prev) => {
                    const next = [...prev];
                    next[idx] = {
                      ...next[idx],
                      venueId: venue?.id ?? null,
                      linkedVenue: venue,
                    };
                    return next;
                  });
                }}
                onUpdate={(patch) => {
                  setEditableEvents((prev) => {
                    const next = [...prev];
                    next[idx] = { ...next[idx], ...patch };
                    return next;
                  });
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
