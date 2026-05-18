# WIG

WIG is a full-stack social events product built on Next.js, Clerk, tRPC, Drizzle, and Neon. This repo now also includes a first-pass Expo / React Native mobile app scaffold in the same workspace.

## Apps

- Web app: `/Users/lukeheary/Documents/Coding/wig`
- Mobile app: [apps/mobile/README.md](/Users/lukeheary/Documents/Coding/wig/apps/mobile/README.md)

## Shared Packages

- `@wig/api` for shared tRPC client typing/helpers
- `@wig/types` for router-inferred API types
- `@wig/utils` for pure cross-platform helpers
- `@wig/validation` for shared Zod schemas

## Local Setup

1. Install dependencies:

```bash
pnpm install
```

2. Set up the web env file:

```bash
cp .env.example .env.local
```

3. Run the web app:

```bash
pnpm dev:web
```

4. Set up the mobile env file:

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

5. Run the mobile app:

```bash
pnpm dev:mobile
```

## Structure

```text
/Users/lukeheary/Documents/Coding/wig
├── src/                  # Existing Next.js app + backend
├── apps/mobile/          # Expo / React Native app
├── packages/api/         # Shared tRPC client helpers
├── packages/types/       # Shared API output types
├── packages/utils/       # Shared utility helpers
├── packages/validation/  # Shared validation schemas
└── pnpm-workspace.yaml   # Workspace definition
```

## Mobile MVP

The current mobile scaffold includes:

- signed-out auth entry
- onboarding/profile setup
- event feed
- event detail
- going / interested actions
- current-user profile
- basic search and city filtering

The mobile app reuses the existing backend procedures, database schema, and image URL conventions. It intentionally rebuilds the UI in native components instead of porting the web component tree. The current Expo-safe pass is guest-first on mobile while the existing Clerk setup remains unchanged on web.
