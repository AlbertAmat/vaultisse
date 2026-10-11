# Settings

Self-service account management: profile, UI preferences, and the two
feature toggles that change what the rest of the app shows. This document
covers everything under `/user` **except** sessions, password, and
two-factor auth - those are security-critical enough to have their own
write-up in [AUTHENTICATION.md](AUTHENTICATION.md); this one is the rest of
`UserRoute.ts`.

## Contents

- [Profile](#profile)
- [UI preferences](#ui-preferences)
- [Deleting an account](#deleting-an-account)
- [Security notice acknowledgement](#security-notice-acknowledgement)
- [Where this lives in code](#where-this-lives-in-code)

## Profile

| Endpoint | Purpose |
|---|---|
| `PUT /user` | Update `name`, `email`, `language`, `region`. |
| `POST /user/image` | Upload/replace the profile picture (multer, 2MB cap, PNG/JPEG only), stored as raw bytes in `users.image`. |
| `DELETE /user/image` | Clear it (`users.image = NULL`). |

`users.image` is converted to a `data:image/png;base64,...` URL on read
(`getUser()` in [`AppRoute.ts`](../server/src/routes/AppRoute.ts), part of
the [policy bootstrap](CATALOG.md#the-policy-bootstrap)) - the client never
deals with raw bytes.

Changing `language` here is a profile field, not an immediate UI language
switch by itself - the actual active locale is set from
`GET /app/policy`'s `user.language` on the *next* policy fetch (login, or a
manual reload), via `i18n.global.locale.value` in
[`ApplicationService.fetchPolicy()`](../client/src/service/ApplicationService.ts).

## UI preferences

Two small per-user toggles, each its own `PATCH` endpoint so the client can
persist an instant, optimistic UI change independently of the rest of the
profile form:

- **`PATCH /user/theme`** - `"beige"` or `"library"` (400 on anything else).
  See `client/src/plugins/theme.ts` for what each theme actually changes.
- **`PATCH /user/sidebar-rail`** - boolean; whether the left nav collapses
  to icon-only "rail" mode (expanding on hover) instead of staying fully
  expanded. Read by `AppMenu.vue`.

Both are applied client-side immediately for instant feedback, then
persisted in the background purely so they're restored on the next login -
neither blocks on the request completing.

## Deleting an account

**`DELETE /user`** removes the `users` row outright and redirects to
`/login`. Everything else the account owns - books, stocks, locations,
customers, activity log, sessions - cascades via database foreign keys;
there's no soft-delete, export prompt, or confirmation step at the API
level (the client is expected to confirm before calling this).

## Security notice acknowledgement

**`POST /user/security-notice/accept`** - idempotent acknowledgement of the
security-measures notice shown after login to accounts flagged as a public
institution (`users.is_public_institution`). `GET /app/policy` reports
whether it's still pending as `user.securityNoticeAccepted`; see
`SecurityNoticeDialog.vue` for the UI and `AppRoute.ts`'s `getUser()`/
`recordSecurityNoticeSent()` for how the "first time shown" timestamp is
recorded (once, via `ON CONFLICT DO NOTHING`).

## Where this lives in code

| Concern | File |
|---|---|
| Profile, preferences, account deletion, security notice | `server/src/routes/UserRoute.ts` |
| Session list/revoke, password change, 2FA | `server/src/routes/UserRoute.ts` - see [AUTHENTICATION.md](AUTHENTICATION.md) instead |
| `users` schema | `assets/db/databaseSchema.sql` |
| Client: `/user` HTTP client | `client/src/service/user/UserService.ts` |
| Client: page controller | `client/src/controller/settings/SettingsController.ts` |
| Client: settings page UI | `client/src/views/settings/SettingsView.vue`, `SettingsCard.vue` |
| Client: theme definitions | `client/src/plugins/theme.ts` |
