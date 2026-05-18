# WIG Mobile

Expo + React Native mobile app for WIG.

## Run locally

1. Install workspace dependencies from the repo root:

```bash
pnpm install
```

2. Copy the mobile env example:

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

3. Set:

- `EXPO_PUBLIC_API_URL`

4. Start the existing Next.js app from the repo root:

```bash
pnpm dev:web
```

5. Start Expo:

```bash
pnpm dev:mobile
```

## Notes

- The mobile app talks to the existing tRPC backend at `/api/trpc`.
- This Expo-safe MVP is currently guest-first while native auth is disabled.
- UI is intentionally native-only and does not attempt to reuse web components.
