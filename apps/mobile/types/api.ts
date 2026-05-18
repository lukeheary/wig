export type RSVPStatus = "going" | "interested" | "not_going";

export type EventListItem = {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  eventUrl?: string | null;
  city: string;
  state: string;
  startAt: string | Date;
  endAt?: string | Date | null;
  status?: string | null;
  updatedAt?: string | Date | null;
  categories?: string[];
  venue?: {
    id: string;
    name: string;
    logoImageUrl: string | null;
  } | null;
  organizer?: {
    id: string;
    name: string;
    logoImageUrl: string | null;
  } | null;
  userRsvp?: {
    status: RSVPStatus;
    notGoingReason?: string | null;
  } | null;
  friendsGoing?: Array<unknown> | null;
  friendsInterested?: Array<unknown> | null;
};

export type EventDetail = EventListItem;

export type CurrentUser = {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  avatarImageUrl: string | null;
  city: string | null;
  state: string | null;
  gender: "male" | "female" | "other" | null;
  dateOfBirth: string | null;
  isOnboarding: boolean;
};

export type AvailableCity = {
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  radiusMiles?: number | null;
};

export type PlaceListItem = {
  id: string;
  type: "venue" | "organizer";
  name: string;
  slug: string;
  description: string | null;
  city: string;
  state: string;
  logoImageUrl: string | null;
  eventCount: number;
  categories?: string[];
};
