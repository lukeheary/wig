import { type EventListItem } from "@/types/trpc";

export type EventCardItem = Omit<
  EventListItem,
  "friendsInterested" | "isFollowed"
> & {
  friendsInterested?: EventListItem["friendsInterested"];
  isFollowed?: EventListItem["isFollowed"];
};

export type SocialUser = {
  id: string;
  avatarImageUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  rsvpStatus: "going" | "interested";
};

/** @deprecated Immutable image keys no longer need query-string versions. */
export function withImageVersion(
  imageUrl: string | null | undefined,
  _updatedAt?: Date | string | null
) {
  return imageUrl ?? null;
}

export function getGoingSocialUsers(event: EventCardItem): SocialUser[] {
  const friendsGoing = event.friendsGoing ?? [];

  return friendsGoing.flatMap((rsvp) => {
    if (rsvp.status !== "going") {
      return [];
    }

    return [
      {
        ...rsvp.user,
        rsvpStatus: rsvp.status,
      },
    ];
  });
}

export function getInterestedCount(event: EventCardItem) {
  return (event.friendsInterested ?? []).filter(
    (rsvp) => rsvp.status === "interested"
  ).length;
}

export function getEventImageUrl(event: EventCardItem) {
  return (
    event.coverImageUrl ||
    event.venue?.logoImageUrl ||
    event.organizer?.logoImageUrl ||
    null
  );
}
