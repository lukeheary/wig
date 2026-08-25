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

### Google Analytics setup

1. Register the iOS bundle ID in Firebase and enable Google Analytics.
2. Download `GoogleService-Info.plist` and place it at `WIG/Support/GoogleService-Info.plist`.
3. Regenerate the project with `xcodegen generate`.

Analytics safely remains disabled in local builds where the plist is absent. Do
not add user-entered text, email addresses, names, birthdays, raw search terms,
or unique content identifiers as event parameters.
