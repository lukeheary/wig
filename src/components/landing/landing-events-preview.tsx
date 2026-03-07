"use client";

import { trpc } from "@/lib/trpc";
import { EventCardGrid } from "@/components/events/event-card-grid";
import { Loader2, CalendarIcon } from "lucide-react";

export function LandingEventsPreview() {
  const limit = 8;

  const { data: events, isLoading } =
    trpc.event.listPublicEventsPreview.useQuery({
      limit,
    });

  return (
    <div className="space-y-6">
      {/*<div className="flex flex-col gap-2 sm:flex-row sm:items-center">*/}
      {/*  <SearchInput*/}
      {/*    placeholder="Search events..."*/}
      {/*    value={search}*/}
      {/*    onChange={setSearch}*/}
      {/*    className="w-full sm:flex-1"*/}
      {/*  />*/}
      {/*  <ResponsiveSelect*/}
      {/*    value={selectedCity}*/}
      {/*    onValueChange={setSelectedCity}*/}
      {/*    options={[*/}
      {/*      { value: "all", label: "All Cities" },*/}
      {/*      ...(cities?.map((city) => ({*/}
      {/*        value: city.city,*/}
      {/*        label: `${city.city}, ${city.state}`,*/}
      {/*      })) || []),*/}
      {/*    ]}*/}
      {/*    placeholder="Select city"*/}
      {/*    title="Select City"*/}
      {/*    className="shrink-0 sm:w-[200px]"*/}
      {/*  />*/}
      {/*</div>*/}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !events || events.length === 0 ? (
        <div className="py-12 text-center">
          <CalendarIcon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">No events found</h3>
          <p className="text-muted-foreground">
            Check back later for upcoming events
          </p>
        </div>
      ) : (
        <EventCardGrid
          events={events}
          columns={{ mobile: 1, tablet: 3, desktop: 4 }}
          gap="md"
        />
      )}

      {/*<div className="flex justify-center pt-2">*/}
      {/*  <Link href="/sign-up">*/}
      {/*    <Button size="lg" variant="outline">*/}
      {/*      Sign up to see more*/}
      {/*    </Button>*/}
      {/*  </Link>*/}
      {/*</div>*/}
    </div>
  );
}
