# Account-specific event source preferences

Admin Overview → User controls (`/admin/users`) → search username → **Event sources**.
Enable **Hide Posh** or **Hide Dice** to hide those sources for the selected account.
The preference is independent of whether that user's profile is hidden.

The backend uses the authenticated viewer's Clerk ID, never an arbitrary account
ID from a feed request. Preferences apply to mobile and web discovery, event
lookup, profiles, RSVP/activity queries, event notifications, and friend RSVP
push recipients. Null-source events authored in WIG remain visible.

Global visibility switches remain global and take precedence. To hide Posh/Dice
only from `qatester`, set those preferences on that account, then make the sources
globally visible using the existing admin scraper controls. Other accounts keep
their own preferences. Signed-out viewers use only global visibility rules.

## Deployment

1. Apply migration `0076_user_event_source_visibility` to the production database
   using the migration runner with explicitly supplied production environment
   variables. Migration 0076 is verified in production as of October 21, 2026.
2. Deploy the backend and website together. The native API response shapes have
   not changed, so the submitted iOS build does not need to be replaced.
3. Configure the production `qatester` account using the admin website.
4. Refresh/relaunch the app to discard its in-memory feed caches. API responses
   now use `Cache-Control: private, no-store` and vary on account credentials.

Production deployment completed October 21, 2026:
https://vercel.com/lukehearynarrativcoms-projects/wig/K2y68Gg1awkVmcoBA5cuA2126gRS

`qatester` now hides Posh and Dice; both sources are globally visible. Database
verification returned 0 Posh/Dice events visible to QA, versus 412 active events
under the default rules at deployment time.

The local `.env.local` currently targets the production database too. Do not
assume the default migration/test commands use an isolated dev database. Earlier
"dev" migration/testing labels were incorrect; disposable test rows were removed.

## Regression test

```sh
WIG_TEST_DEV_SOURCE_VISIBILITY=true node --import tsx --test \
  src/server/tests/event-source-visibility.test.ts
```

This opt-in test creates disposable dev users and checks admin authorization,
account isolation, signed-out behavior, null-source visibility, independent
source updates, reversibility, and cascading cleanup. It leaves global source
settings unchanged.
