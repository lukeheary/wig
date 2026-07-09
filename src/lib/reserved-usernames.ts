export const RESERVED_USERNAMES = new Set([
  "admin",
  "api",
  "event",
  "event-series",
  "friends",
  "help-feedback",
  "home",
  "my-places",
  "onboarding",
  "organizer",
  "places",
  "profile",
  "sign-in",
  "sign-up",
  "support",
  "venue",
  "venues-and-organizers",
  "www",
]);

export function isReservedUsername(username: string) {
  return RESERVED_USERNAMES.has(username.toLowerCase().trim());
}
