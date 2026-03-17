"use client";

import { trpc } from "@/lib/trpc";
import { EventCardGrid } from "@/components/events/event-card-grid";
import { Loader2, CalendarIcon } from "lucide-react";
import { type EventListItem } from "@/types/trpc";

const MOCK_EVENT_ATTENDEES = [
  {
    id: "landing-user-1",
    firstName: "Maya",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-2",
    firstName: "Theo",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-3",
    firstName: "Ari",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-4",
    firstName: "Lena",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-5",
    firstName: "Parker",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-6",
    firstName: "Zoe",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-7",
    firstName: "Kai",
    lastName: null,
    avatarImageUrl: null,
  },
  {
    id: "landing-user-8",
    firstName: "Sofia",
    lastName: null,
    avatarImageUrl: null,
  },
];

function withMockFriendsGoing(events: EventListItem[]): EventListItem[] {
  return events.map((event, index) => {
    const attendeeCount = ((event.title.length + index) % 4) + 1;
    const startIndex = index % MOCK_EVENT_ATTENDEES.length;
    const friendsGoing = Array.from({ length: attendeeCount }, (_, offset) => ({
      status: offset === attendeeCount - 1 && attendeeCount > 1 ? "interested" : "going",
      user: MOCK_EVENT_ATTENDEES[
        (startIndex + offset) % MOCK_EVENT_ATTENDEES.length
      ],
    })) as EventListItem["friendsGoing"];

    return {
      ...event,
      friendsGoing: friendsGoing.filter((rsvp) => rsvp.status === "going"),
      friendsInterested: friendsGoing.filter(
        (rsvp) => rsvp.status === "interested"
      ),
    };
  });
}

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
          events={withMockFriendsGoing(events)}
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
