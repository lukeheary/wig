/** Fictional, response-only screenshot fixtures. Never writes users or RSVPs. */
export function screenshotFriendsEnabled() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.WIG_SCREENSHOT_FRIENDS === "true"
  );
}

const PEOPLE = [
  ["Avery", "Chen"],
  ["Jordan", "Rivera"],
  ["Maya", "Patel"],
  ["Sam", "Brooks"],
  ["Riley", "Morgan"],
  ["Alex", "Reed"],
];

type Payload = Record<string, any>;

function appURL() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
}

export function screenshotFriends() {
  return PEOPLE.map(([firstName, lastName], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    username: `${firstName.toLowerCase()}${lastName.toLowerCase()}`,
    // Use the app's real initials fallback, including its identity-based palette.
    avatarImageUrl: null,
    city: "Boston",
    state: "MA",
    friendStatus: "accepted",
    notificationsMuted: false,
    isCurrentUser: false,
    isFriend: true,
  }));
}

// Keep the October 18 Carly Pearce show out of screenshot RSVP fixtures.
const RSVP_EXCLUDED_EVENT_IDS = new Set(["f02a0271-296f-4315-b2ff-3f95041ba096"]);

function decorateEvent(event: Payload) {
  if (RSVP_EXCLUDED_EVENT_IDS.has(event.id)) {
    return {
      ...event,
      userRsvpStatus: null,
      userRsvpNotGoingReason: null,
      goingCount: 0,
      friendsGoing: [],
      friendsInterested: [],
      friendsNotGoing: [],
    };
  }
  const people = screenshotFriends();
  // Stable per-event variation keeps feed cards and detail responses in sync.
  const seed = [...String(event.id)].reduce(
    (hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0,
    0
  );
  const offset = seed % people.length;
  let goingCount = seed % 4;
  let interestedCount = Math.floor(seed / 4) % 4;
  const localDateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: event.timeZone || "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(event.startAt));
  const datePart = (type: string) => localDateParts.find((part) => part.type === type)?.value;
  if (`${datePart("year")}-${datePart("month")}-${datePart("day")}` === "2026-10-19") {
    // Home ranks each day by social RSVP count. Reserve the first two
    // screenshot positions while retaining varied counts for other shows.
    if (String(event.title).startsWith("EMEI")) {
      goingCount = 3;
      interestedCount = 3;
    } else if (event.title === "Brand New") {
      goingCount = 3;
      interestedCount = 2;
    } else {
      interestedCount = Math.min(interestedCount, 4 - goingCount);
    }
  }
  const ordered = [...people.slice(offset), ...people.slice(0, offset)];
  return {
    ...event,
    friendsGoing: ordered
      .slice(0, goingCount)
      .map((user) => ({ status: "going", user })),
    friendsInterested: ordered
      .slice(goingCount, goingCount + interestedCount)
      .map((user) => ({ status: "interested", user })),
    friendsNotGoing: [],
    goingCount,
  };
}

// Match the profile's display window: tonight stays upcoming until 6 AM,
// even when a source supplies no end time. Use each event's local date.
export function screenshotProfileEventIsPast(event: Payload, now = new Date()) {
  const timeZone = event.timeZone || "America/New_York";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", hourCycle: "h23",
  });
  function localParts(value: Date) {
    const parts = formatter.formatToParts(value);
    const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    return { day: Date.UTC(part("year"), part("month") - 1, part("day")), hour: part("hour") };
  }
  const current = localParts(now);
  const cutoff = current.day - (current.hour < 6 ? 86400000 : 0);
  return localParts(new Date(event.startAt)).day < cutoff;
}

async function sampleEvents(forProfile = false) {
  const url = new URL("/api/mobile/events", appURL());
  url.searchParams.set("limit", forProfile ? "500" : "40");
  if (forProfile) {
    url.searchParams.set(
      "endDate",
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    );
  }
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Screenshot events unavailable: HTTP ${response.status}`);
  const feed = await response.json();
  const events: Payload[] = (feed.events ?? []).filter(
    (event: Payload) => !RSVP_EXCLUDED_EVENT_IDS.has(event.id)
  );
  const upcoming = events.filter((event) =>
    forProfile
      ? !screenshotProfileEventIsPast(event)
      : new Date(event.endAt ?? event.startAt).getTime() > Date.now()
  );
  if (forProfile) {
    // Spread plans over the next three months instead of filling the profile
    // with many events on the same night. Keep real event dates and artwork.
    const count = Math.min(18, upcoming.length);
    return Array.from({ length: count }, (_, index) =>
      decorateEvent(upcoming[Math.floor((index * upcoming.length) / count)])
    );
  }
  return (upcoming.length ? upcoming : events).slice(0, 8).map(decorateEvent);
}

async function samplePastEvents(upcoming: Payload[]) {
  const slugs = [
    ...new Set(
      upcoming
        .map((event) => event.venueSlug ?? event.organizerSlug)
        .filter(Boolean)
    ),
  ].slice(0, 8);
  const pages = await Promise.all(
    slugs.map(async (slug) => {
      const response = await fetch(
        new URL(`/api/mobile/places/${encodeURIComponent(slug)}`, appURL()),
        {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!response.ok)
        throw new Error(
          `Screenshot past events unavailable: HTTP ${response.status}`
        );
      return response.json();
    })
  );
  const upcomingIDs = new Set(upcoming.map((event) => event.id));
  const unique = new Map<string, Payload>();
  for (const page of pages) {
    for (const event of page.pastEvents ?? []) {
      if (
        !RSVP_EXCLUDED_EVENT_IDS.has(event.id) &&
        !upcomingIDs.has(event.id) &&
        screenshotProfileEventIsPast(event)
      ) {
        unique.set(event.id, event);
      }
    }
  }
  const events = [...unique.values()].sort(
    (a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime()
  );
  // Match the profile's Monday-based weeks in each event's local time zone.
  function weekStart(value: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(value);
    const part = (type: string) =>
      Number(parts.find((part) => part.type === type)!.value);
    const day = new Date(
      Date.UTC(part("year"), part("month") - 1, part("day"))
    );
    return day.getTime() - ((day.getUTCDay() + 6) % 7) * 86400000;
  }
  const weeks = new Map<number, Payload[]>();
  for (const event of events) {
    const timeZone = event.timeZone || "America/New_York";
    const age = Math.round(
      (weekStart(new Date(), timeZone) -
        weekStart(new Date(event.startAt), timeZone)) /
        (7 * 86400000)
    );
    if (age < 0 || age > 5) continue;
    const bucket = weeks.get(age) ?? [];
    if (bucket.length < 6) bucket.push(event);
    weeks.set(age, bucket);
  }
  // Give each recent week a full Attended row, plus Interested history.
  return [...weeks.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, week]) =>
      week.map((event, index) => ({
        ...decorateEvent(event),
        userRsvpStatus: index < 4 ? "going" : "interested",
        userRsvpNotGoingReason: null,
      }))
    );
}

export async function withScreenshotFriends(
  payload: Payload,
  kind: "feed" | "detail" | "friends" | "activity" | "home-activity"
) {
  if (!screenshotFriendsEnabled()) return payload;
  if (
    kind === "home-activity" &&
    process.env.WIG_SCREENSHOT_HIDE_HOME_ACTIVITY === "true"
  ) {
    return { ...payload, activities: [] };
  }

  if (kind === "detail") return decorateEvent(payload);
  if (kind === "feed") {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        ["events", "latestFromPlaces", "latestFromFollows"].includes(key) &&
        Array.isArray(value)
          ? value.map(decorateEvent)
          : value,
      ])
    );
  }

  const people = screenshotFriends();
  const events = await sampleEvents(kind === "friends");
  if (kind === "friends") {
    const pastEvents = await samplePastEvents(events);
    return {
      ...payload,
      friendCount: people.length,
      requestCount: 0,
      friends: people,
      receivedRequests: [],
      sentRequests: [],
      pastEvents,
      upcomingEvents: events.map((event, index) => ({
        ...event,
        userRsvpStatus: index % 3 === 1 ? "interested" : "going",
        userRsvpNotGoingReason: null,
      })),
    };
  }

  const anchor = Math.floor(Date.now() / 60000) * 60000;
  const usedActors = new Set<string>();
  const activities = events
    .filter((event) => event.friendsGoing.length || event.friendsInterested.length)
    .slice(0, 8).map((event, index) => {
    const interested = event.friendsInterested.length > 0 &&
      (index % 3 === 1 || event.friendsGoing.length === 0);
    const candidates = interested
      ? event.friendsInterested
      : event.friendsGoing;
    const actor = (
      candidates.find((rsvp: Payload) => !usedActors.has(rsvp.user.id)) ??
      candidates[0]
    ).user;
    usedActors.add(actor.id);
    const timestamp = new Date(
      anchor - [5, 18, 42, 75, 120, 180, 240, 300][index] * 60000
    ).toISOString();
    return {
      id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`,
      type: interested ? "rsvp_interested" : "rsvp_going",
      actorUserId: actor.id,
      actorName: actor.name,
      actorFirstName: actor.firstName,
      actorGender: null,
      actorAvatarImageUrl: actor.avatarImageUrl,
      partnerFirstName: null,
      partnerUserId: null,
      notGoingReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      event,
    };
  });
  // Use a stable shuffled order for screenshots. The first three people
  // have coral, violet, and turquoise avatars in the app's native palette.
  const remaining = [...activities];
  const ordered = [0, 3, 1, 4, 2, 5, 2, 0]
    .flatMap((personIndex) => {
      const match = remaining.findIndex(
        (activity) => activity.actorUserId === people[personIndex].id
      );
      if (!remaining.length) return [];
      return remaining.splice(match >= 0 ? match : 0, 1);
    })
    .map((activity, index) => {
      const timestamp = new Date(
        anchor - [5, 18, 42, 75, 120, 180, 240, 300][index] * 60000
      ).toISOString();
      return { ...activity, createdAt: timestamp, updatedAt: timestamp };
    });
  return {
    ...payload,
    friendCount: people.length,
    requestCount: 0,
    activities: ordered.slice(0, kind === "home-activity" ? 3 : 8),
  };
}

export async function screenshotFriendProfile(id: string) {
  if (!screenshotFriendsEnabled()) return null;
  const people = screenshotFriends();
  const person = people.find((person) => person.id === id);
  if (!person) return null;
  const events = await sampleEvents();
  return {
    profile: person,
    friendCount: people.length - 1,
    followingCount: 0,
    followedPlaces: [],
    memberPlaceCount: 0,
    memberPlaces: [],
    friends: people.filter((friend) => friend.id !== id),
    promotingEvents: [],
    upcomingEvents: events.filter((event) =>
      event.friendsGoing.some((rsvp: Payload) => rsvp.user.id === id)
    ),
    pastEvents: [],
  };
}
