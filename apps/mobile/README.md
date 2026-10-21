## WIG iOS

This folder now contains the native SwiftUI app scaffold for WIG.

### Structure

- `project.yml`: XcodeGen spec for the iOS app target and Clerk dependencies
- `WIG/`: SwiftUI source tree

### Clerk setup

1. Enable the Native API in Clerk.
2. Add your iOS app in the Clerk dashboard.
3. Copy `Config/Local.example.xcconfig` to `Config/Local.xcconfig` for Debug builds and set:
   - `CLERK_PUBLISHABLE_KEY`
   - `CLERK_FRONTEND_API`
   - `API_BASE_URL`
   - `CLERK_JWT_TEMPLATE` (optional, if your backend expects a custom JWT template)
4. Add the Associated Domains capability with:
   - `webcredentials:$(CLERK_FRONTEND_API)`

### Generate the Xcode project

This repo includes an XcodeGen spec instead of a checked-in `.xcodeproj`.

```bash
brew install xcodegen
cd apps/mobile
xcodegen generate
open WIG.xcodeproj
```

### Build config

`Debug.xcconfig` includes `Local.xcconfig` if it exists. Use it for local development values like test Clerk keys and ngrok URLs.

`Release.xcconfig` includes `Production.xcconfig` if it exists. Xcode archives use the Release configuration by default, so TestFlight builds should read production Clerk and API values from `Production.xcconfig`.

```bash
cd apps/mobile
cp Config/Local.example.xcconfig Config/Local.xcconfig
cp Config/Production.example.xcconfig Config/Production.xcconfig
```

After editing either local config file, regenerate the project if needed:

```bash
xcodegen generate
```

If you prefer, you can also create an Xcode project manually and add `ClerkKit` and `ClerkKitUI` from `https://github.com/clerk/clerk-ios`.

### Analytics

Analytics is temporarily disabled. `AppAnalytics` remains as a no-op boundary
so an analytics provider can be restored without changing its call sites.

### Global event source visibility

In the iOS app, open Profile → Admin Settings → Scrapers → Event Visibility.
Turn a source off to hide its events for everyone on the connected backend.
The setting is saved in the database and applies to event discovery, search,
place pages, profiles, and event details. Events and RSVPs are retained, and
scrapers keep running. Turn the source back on to restore its events.

Apply migration `0074_event_source_visibility` before deploying this code.
Source settings belong to each backend database; changing local dev does not
change production. Existing clients see the setting when they refresh data.

### Screenshot friends (local development only)

Set `WIG_SCREENSHOT_FRIENDS=true` in the backend's `.env.local` to add six
fictional friends, event RSVPs, and recent friend activity to API responses.
Your profile also gets 18 future plans (12 Going and 6 Interested), spread over
the next three months, plus past plans grouped across the last few weeks (up to four Attended and
two Interested per week).
Past plans use real historical events and dates. Their avatars use the app's regular initials fallback and identity-based color palette. The fixtures use real, currently
visible dev events and do not write users, friendships, or RSVPs to the database.
They never send notifications. Friend profile previews work in this mode too.

Set `WIG_SCREENSHOT_FRIENDS=false` (or remove it), then relaunch the simulator
to return to real data. This mode is ignored when `NODE_ENV` is `production`.
