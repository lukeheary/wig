export const USER_SURFACE_VALUES = ["home_recent_activity"] as const;

export type UserSurface = (typeof USER_SURFACE_VALUES)[number];

export const HOME_RECENT_ACTIVITY_SURFACE: UserSurface =
  "home_recent_activity";
