import { type EventListItem } from "@/types/trpc";

export type EventCardItem = Omit<EventListItem, "friendsInterested"> & {
  friendsInterested?: EventListItem["friendsInterested"];
};

export type SocialUser = {
  id: string;
  avatarImageUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  rsvpStatus: "going" | "interested";
};

export function getSocialUsers(event: EventCardItem): SocialUser[] {
  const friendsGoing = event.friendsGoing ?? [];
  const friendsInterested = event.friendsInterested ?? [];

  return [...friendsGoing, ...friendsInterested].flatMap((rsvp) => {
    if (rsvp.status !== "going" && rsvp.status !== "interested") {
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

export function getEventImageUrl(event: EventCardItem) {
  return (
    event.coverImageUrl ||
    event.venue?.logoImageUrl ||
    event.organizer?.logoImageUrl ||
    null
  );
}
