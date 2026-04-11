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

function toVersionToken(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : String(time);
}

export function withImageVersion(
  imageUrl: string | null | undefined,
  updatedAt?: Date | string | null
) {
  if (!imageUrl) return null;

  const version = toVersionToken(updatedAt);
  if (!version) return imageUrl;

  const separator = imageUrl.includes("?") ? "&" : "?";
  return `${imageUrl}${separator}v=${version}`;
}

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
    withImageVersion(event.coverImageUrl, event.updatedAt) ||
    event.venue?.logoImageUrl ||
    event.organizer?.logoImageUrl ||
    null
  );
}
