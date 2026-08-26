"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { MobileFilterPills } from "@/components/ui/mobile-filter-pills";

type AttendanceFilter = "going" | "interested";

export default function EventFriendsPage() {
  const router = useRouter();
  const params = useParams();
  const eventPublicId = params.id as string;
  const [filter, setFilter] = useState<AttendanceFilter>("going");

  const { data: event, isLoading: eventLoading } =
    trpc.event.getEventById.useQuery({ eventId: eventPublicId });
  const { data: attendees = [], isLoading: attendeesLoading } =
    trpc.event.listEventAttendees.useQuery(
      { eventId: event?.id ?? "00000000-0000-0000-0000-000000000000" },
      { enabled: Boolean(event?.id) }
    );
  const { data: friendships = [], isLoading: friendsLoading } =
    trpc.friends.listFriends.useQuery({});

  const friendIds = useMemo(
    () =>
      new Set(
        friendships
          .filter((friendship) => friendship.status === "accepted")
          .map((friendship) => friendship.friend?.id)
          .filter(Boolean)
      ),
    [friendships]
  );
  const going = attendees.filter(
    (attendee) => attendee.status === "going" && friendIds.has(attendee.userId)
  );
  const interested = attendees.filter(
    (attendee) =>
      attendee.status === "interested" && friendIds.has(attendee.userId)
  );
  const visibleFriends = filter === "going" ? going : interested;
  const filters = [
    { value: "going" as const, label: `Going (${going.length})` },
    {
      value: "interested" as const,
      label: `Interested (${interested.length})`,
    },
  ];
  const isLoading = eventLoading || attendeesLoading || friendsLoading;

  return (
    <main className="min-h-screen bg-black px-5 pb-8 pt-3 text-white">
      <div className="grid h-12 grid-cols-[3rem_1fr_3rem] items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          className="h-12 w-12 rounded-3xl border border-white/15 bg-[#242426]/85 text-white shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl hover:bg-[#242426]/85"
          aria-label="Go back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-center text-[17px] font-bold">Friends</h1>
      </div>

      <MobileFilterPills
        options={filters}
        value={filter}
        onValueChange={setFilter}
        className="mt-5"
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-7 w-7 animate-spin text-white/35" />
        </div>
      ) : visibleFriends.length === 0 ? (
        <p className="py-12 text-center text-sm text-white/50">
          No friends are {filter === "going" ? "going" : "interested"} yet.
        </p>
      ) : (
        <div className="mt-5">
          {visibleFriends.map((attendee) => {
            const displayName =
              [attendee.user.firstName, attendee.user.lastName]
                .filter(Boolean)
                .join(" ") ||
              attendee.user.username ||
              "Friend";
            const row = (
              <div className="flex min-h-[4.25rem] items-center gap-3 rounded-xl px-2 py-2 transition-colors active:bg-white/[0.06]">
                <UserAvatar
                  src={attendee.user.avatarImageUrl}
                  name={displayName}
                  identityKey={attendee.user.id}
                  className="h-[3.25rem] w-[3.25rem] rounded-full"
                  size={52}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">
                    {displayName}
                  </p>
                  {attendee.user.username ? (
                    <p className="mt-0.5 truncate text-xs font-medium text-white/50">
                      @{attendee.user.username}
                    </p>
                  ) : null}
                </div>
              </div>
            );

            return attendee.user.username ? (
              <Link key={attendee.id} href={`/${attendee.user.username}`}>
                {row}
              </Link>
            ) : (
              <div key={attendee.id}>{row}</div>
            );
          })}
        </div>
      )}
    </main>
  );
}
