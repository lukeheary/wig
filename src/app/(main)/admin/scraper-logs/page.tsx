"use client";

import { useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { BackButtonHeader } from "@/components/shared/back-button-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

type ScraperLogStatus = "success" | "error" | "partial";

interface LogData {
  eventsFound: { title: string; externalId: string | null }[];
  eventsAdded: { id: string; title: string; externalId: string | null }[];
}

interface ScraperLog {
  id: string;
  scraperId: string | null;
  placeId: string | null;
  placeName: string;
  scraper: "dice" | "posh" | "ticketmaster" | "eventbrite";
  status: ScraperLogStatus;
  eventsFound: number;
  eventsAdded: number;
  durationMs: number | null;
  error: string | null;
  data: LogData | null;
  ranAt: Date;
}

const scraperLabels: Record<string, string> = {
  dice: "Dice.fm",
  eventbrite: "Eventbrite",
  posh: "Posh",
  ticketmaster: "Ticketmaster",
};

const statusConfig: Record<
  ScraperLogStatus,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    icon: React.ElementType;
  }
> = {
  success: { label: "Success", variant: "default", icon: CheckCircle2 },
  partial: { label: "Partial", variant: "outline", icon: AlertTriangle },
  error: { label: "Error", variant: "destructive", icon: AlertCircle },
};

function formatDuration(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function LogRow({ log }: { log: ScraperLog }) {
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[log.status];
  const StatusIcon = config.icon;
  const data = log.data as LogData | null;

  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-accent/50"
      >
        <div className="shrink-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">
              {log.placeName}
            </span>
            <Badge variant="outline" className="shrink-0 text-xs">
              {scraperLabels[log.scraper] ?? log.scraper}
            </Badge>
            <Badge variant={config.variant} className="shrink-0 gap-1 text-xs">
              <StatusIcon className="h-3 w-3" />
              {config.label}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>
              {formatDistanceToNow(new Date(log.ranAt), { addSuffix: true })}
            </span>
            <span>{log.eventsFound} found</span>
            <span className="font-medium text-foreground">
              {log.eventsAdded} added
            </span>
            <span>{formatDuration(log.durationMs)}</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="space-y-2 px-10 pb-3 text-sm">
          <div className="text-xs text-muted-foreground">
            {format(new Date(log.ranAt), "PPpp")}
          </div>

          {log.error && (
            <div className="rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {log.error}
            </div>
          )}

          {data && data.eventsAdded.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Events added ({data.eventsAdded.length})
              </p>
              <ul className="space-y-0.5">
                {data.eventsAdded.map((e, i) => (
                  <li key={i} className="text-xs text-foreground">
                    {e.title}
                    {e.externalId && (
                      <span className="ml-1 text-muted-foreground">
                        #{e.externalId}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data &&
            data.eventsFound.length > 0 &&
            data.eventsAdded.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {data.eventsFound.length} event
                {data.eventsFound.length !== 1 ? "s" : ""} found, all already in
                database.
              </p>
            )}

          {(!data ||
            (data.eventsFound.length === 0 && data.eventsAdded.length === 0)) &&
            !log.error && (
              <p className="text-xs text-muted-foreground">No events found.</p>
            )}
        </div>
      )}
    </div>
  );
}

export default function ScraperLogsPage() {
  const {
    data: logs,
    isLoading,
    refetch,
    isFetching,
  } = trpc.admin.listScraperLogs.useQuery({ limit: 200 });

  return (
    <div className="space-y-6">
      <BackButtonHeader backHref="/admin" title="Scraper Logs" />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle>Recent Runs</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading logs...
            </div>
          ) : !logs || logs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No scraper runs yet. Logs will appear here after the cron job
              runs.
            </p>
          ) : (
            <div>
              {logs.map((log) => (
                <LogRow key={log.id} log={log as ScraperLog} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
