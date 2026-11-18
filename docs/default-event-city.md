# Default Event City

In the iOS app, Profile → ⋯ → Default Event City opens a settings page using the same shared header, back button, form layout, and background as Notification Settings. Users choose an available city and tap Save Default City.

The selection updates the existing authenticated account field `users.metro_area_id`, which onboarding already uses for the default browsing city. It does not change public-profile `city` or `state`. Temporary browsing selections still live only in AppSession. Signing into a different account clears that temporary selection.

Home, Places, and Activity already use `metro_area_id` as their default. Saving applies the new city across the current tabs immediately, invalidates cached Home weeks, and refreshes the feeds. Home's feed time zone follows the browsing default. Selecting another city through existing browsing controls does not write the default.

`GET /api/mobile/default-event-city` returns available enabled metros and the saved default. Authenticated `PATCH` accepts only a `metroAreaId` UUID identifying an enabled metro. Both handlers scope reads/writes to the authenticated user and use private/no-store responses. The city options come from the existing supported metro areas; this page does not add new cities or request location permission.

No database migration is needed for this feature. Deploy the new backend endpoint and ship the updated iOS app.
