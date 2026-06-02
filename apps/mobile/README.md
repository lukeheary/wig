## WIG iOS

This folder now contains the native SwiftUI app scaffold for WIG.

### Structure

- `project.yml`: XcodeGen spec for the iOS app target and Clerk dependencies
- `WIG/`: SwiftUI source tree

### Clerk setup

1. Enable the Native API in Clerk.
2. Add your iOS app in the Clerk dashboard.
3. Copy `Config/Local.example.xcconfig` to `Config/Local.xcconfig` and set:
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

### Local config

`Debug.xcconfig` and `Release.xcconfig` both include `Local.xcconfig` if it exists.

```bash
cd apps/mobile
cp Config/Local.example.xcconfig Config/Local.xcconfig
```

After editing `Local.xcconfig`, regenerate the project if needed:

```bash
xcodegen generate
```

If you prefer, you can also create an Xcode project manually and add `ClerkKit` and `ClerkKitUI` from `https://github.com/clerk/clerk-ios`.
