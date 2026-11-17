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

`Release.xcconfig` includes `Production.xcconfig` if it exists. The production schemes archive with the Release configuration, so TestFlight builds should read production Clerk and API values from `Production.xcconfig`.

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

### Development and App Store apps together

Select **WIG Dev**, select your iPhone, then **Run (Command-R)** to install and
launch development. Build (Command-B) only compiles the app.

- Debug / WIG Dev: `com.whoisgoing.app.dev`, displayed as **WIG Dev**.
- ProdLocal / Release: `com.whoisgoing.app`, displayed as **Who Is Going**.

These are separate installed apps with separate app storage and default Keychain
access. WIG Dev uses Debug for Run, Profile, and Archive; use the WIG or WIG Prod
Local scheme to archive Release builds for the App Store. The Dev scheme reads
Clerk and backend values from `Config/Local.xcconfig` baked into the app, so
launching from the phone's home screen uses the same environment as Xcode.
For a physical iPhone, API_BASE_URL must use your Mac's reachable LAN address or
a development tunnel rather than localhost.

The OAuth callback scheme follows the bundle identifier automatically:
`com.whoisgoing.app.dev://callback` for development. Native Apple sign-in,
associated domains, and push provisioning must include the development app ID;
Xcode automatic signing can create its development provisioning profile. Register `com.whoisgoing.app.dev` in the Clerk development instance’s Native
applications settings, alongside its `com.whoisgoing.app.dev://callback` OAuth
redirect. Use the App ID Prefix from the Apple development identifier. The local
backend’s `APNS_BUNDLE_ID` must also be `com.whoisgoing.app.dev` with sandbox
delivery enabled; production keeps `com.whoisgoing.app`.

### Simulator startup and Keychain

Keep code signing enabled for builds installed in Simulator or Device Hub. Clerk
uses Keychain storage during `Clerk.configure`; a build made with
`CODE_SIGNING_ALLOWED=NO` can crash immediately with OSStatus `-34018`
(`errSecMissingEntitlement`). A successful compile does not verify this startup path.

For command-line simulator builds, use `CODE_SIGNING_ALLOWED=YES` and
`CODE_SIGN_IDENTITY=-` (local/ad-hoc simulator signing), then reinstall the app
without uninstalling it so its data is retained. If the command-line tools path
points to CommandLineTools, prefix the build and simctl commands with
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

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

Screenshot data is disabled by default. Set `ENABLE_SCREENSHOT_DATA = true` in
`src/server/dev/screenshot-friends.ts` to add six
fictional friends, event RSVPs, and recent friend activity to API responses.
Your profile also gets 18 future plans (12 Going and 6 Interested), spread over
the next three months, plus past plans grouped across the last few weeks (up to four Attended and
two Interested per week).
Past plans use real historical events and dates. Their avatars use the app's regular initials fallback and identity-based color palette. The fixtures use real, currently
visible dev events and do not write users, friendships, or RSVPs to the database.
They never send notifications. Friend profile previews work in this mode too.

Set `ENABLE_SCREENSHOT_DATA = false`, then relaunch the app to clear its cached
responses and return to real data. This mode is ignored when `NODE_ENV` is
`production`. The old `WIG_SCREENSHOT_FRIENDS` environment variable is no longer
used. `WIG_SCREENSHOT_HIDE_HOME_ACTIVITY=true` optionally hides recent activity
while screenshot data is enabled; it has no effect while the flag is off.
