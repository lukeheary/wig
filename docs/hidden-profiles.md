# Hidden reviewer and test profiles

Admins can open `/admin/users` (Admin Overview → Profile visibility), search by
name, username, or email, and choose **Hide profile**. **Make visible** reverses
this setting. No account or RSVP data is deleted.

A hidden account can sign in, browse events, RSVP for itself, and view its own
profile. Other viewers, including signed-out visitors, cannot discover its
profile, social RSVPs, activity, reviews, promotions, or place memberships through
the normal mobile and web read APIs. Friend/partner requests involving hidden
accounts are unavailable. Hidden accounts do not publish social activity or send
social notifications, and partner RSVP mirroring excludes hidden accounts.
Admin user search remains available for managing the flag.

Create the review account and hide it before submitting its credentials to App
Review. This does not retract notifications already delivered or data that
another device cached before the account was hidden.

## Release

Apply `0075_hidden_profiles.sql` to the target database before deploying the code
that reads `users.is_profile_hidden`. Migration has been applied only to local
development during implementation. No production profiles have been changed.

`/support` is a public page with `support@whoisgoing.com`; `/support/tickets`
continues to require sign-in. Deploy the site to publish the page changes.

## Verification

Type checking: `pnpm exec tsc --noEmit`.

Opt-in dev integration test, using disposable rows that are cleaned up afterward:

```sh
WIG_TEST_DEV_PROFILE_VISIBILITY=true WIG_TEST_API_URL=http://localhost:3001 \
  node --import tsx --test src/server/tests/profile-visibility.test.ts
```

The test covers signed-out and other-user exclusion, owner access, notification
and activity suppression, request prevention, admin-only visibility changes,
restoring visibility, actual mobile profile/search endpoints, and public support.
