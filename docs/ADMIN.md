# Admin portal

An optional web console for whoever *runs* a Vaultisse installation, as opposed to
whoever uses it. It exists for two situations:

- You share your installation with other people (family, a club, a school) and want
  to manage accounts and settings without editing `.env` and restarting.
- You host Vaultisse for other people (SaaS-style): many independent accounts, which
  you must be able to look after **without being able to read their libraries**.

It is **off by default**. With `ADMIN_ENABLED` unset or `false`, nothing of it runs:
no extra port, no admin routes, database-stored settings are ignored and plans are
not enforced. The server behaves exactly as before, configured by env vars alone.

## Contents

- [Turning it on](#turning-it-on)
- [How it is built](#how-it-is-built)
- [What it can and can't see](#what-it-can-and-cant-see)
- [Settings without env vars](#settings-without-env-vars)
- [Accounts, vaults and deletions](#accounts-vaults-and-deletions)
- [Plans and quotas](#plans-and-quotas)
- [Security, logs and audit](#security-logs-and-audit)
- [Admin accounts](#admin-accounts)
- [Securing it](#securing-it)
- [Environment variables](#environment-variables)
- [API map](#api-map)
- [Development](#development)

## Turning it on

1. In `.env`:
   ```
   ADMIN_ENABLED=true
   ADMIN_URL=https://adm.example.com     # where you will open it
   SETTINGS_ENCRYPTION_KEY=<openssl rand -hex 32>
   ```
2. Restart the `app` container. The server now also listens on `ADMIN_PORT` (3001).
3. Read the first admin's login from the container output. The first time the portal
   runs with no admin, the server creates one and prints a block like this (once, in
   `docker compose logs app`; it is deliberately not written to the log file the
   console can display):
   ```
   ====================================================================
     ADMIN PORTAL - first start
         username: admin@vaultisse.local
         password: <generated, 20 characters>
     The admin portal is listening on port 3001. Open it at:
         https://adm.example.com   (ADMIN_URL)
         http://localhost:3001
         http://192.168.1.20:3001
     CHANGE THIS PASSWORD AFTER THE FIRST LOGIN: you will be asked to.
   ====================================================================
   ```
   It lists the port and every address of the machine (and `ADMIN_URL`). In Docker,
   those IPs are the container's own: from the host use `localhost` and the published port.
   ```text
   ```
4. Open the portal and sign in with it. Set up two-factor authentication (mandatory,
   save the backup codes it shows once), then the console **makes you choose your
   own password** before anything else works. The same applies to every admin
   another admin creates later: they must replace the password they were given.

   There is no sign-up page for admins. To create one by hand, or to recover a lost
   password, use the command line:
   ```bash
   docker compose exec -it app node index.js admin:create --email you@example.com --name "You"
   docker compose exec -it app node index.js admin:reset  --email you@example.com
   ```
   (`ADMIN_PASSWORD` in the environment replaces the prompt in scripts.) Passwords
   set this way are your choice and aren't forced to change.

To reach it on its own domain, point a reverse proxy at the admin port, e.g. Caddy:

```
adm.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

(`docker-compose.yml` publishes the admin port on `127.0.0.1` only.) Behind a proxy,
set `TRUST_PROXY=true` so the real client address is seen by the rate limiter, the IP
allowlist and the security page.

Turning it off again hands configuration back to the env vars. Anything saved in the
portal stays in the database, dormant, and applies again if you turn the portal back on.

## How it is built

```
client/   the app users open            ─┐
admin/    the admin console (Vue)        │  npm workspaces
server/   Express API                    │
packages/ shared types + API clients    ─┘
```

One server process, two listeners:

| Listener | Port | Serves |
|---|---|---|
| Main | `API_PORT` (3000) | the app, `/api/rest/*` |
| Admin | `ADMIN_PORT` (3001) | the admin console, `/api/admin/*` |

The admin side is separate in every way that matters for security:

- **Own accounts.** Admins live in `admin_users`, not `users`. A flaw in the user API
  can't grant admin rights because the two never share a table, cookie or token.
- **Own session.** A different cookie (`admin_token`, `SameSite=Strict`), JWT audience
  and signing key (derived from `JWT_SECRET`, but not equal to it), own session table
  with 30 minutes idle and 12 hours absolute lifetime.
- **Own port and origin**, so it can sit on its own domain, behind its own firewall
  rule, or not be published at all.
- **Mandatory two-factor**, per-account lockout, strict rate limits, optional IP
  allowlist, cross-origin requests refused.

## What it can and can't see

The portal shows **metadata**: who has an account, which vaults exist, who belongs to
them, how many books, how many bytes, when someone last signed in. It never reads or
returns a vault's books, borrowers, loans or any other content, and there is **no
"sign in as this user"**. An admin can lock, suspend or delete, but not look inside.

This is a property of the code, not a setting: the admin queries
(`server/src/admin/repositories/PlatformRepository.ts`) simply don't select content,
and a test checks that a book title never appears in the admin API's output.

## Settings without env vars

*Settings* edits what used to need an env var and a restart:

| Group | Settings |
|---|---|
| Email (SMTP) | host, port, TLS options, user, password, sender; "send a test email" |
| Registration | allow registration, require admin approval |
| Single sign-on | issuer, client id/secret, redirect URI, scopes, groups claim, SSO only |
| API keys | Google Books and LibraryThing keys, each with a **Test key** button that makes one real request to the provider (with the key typed in the field, or the saved one) and says whether it was accepted, refused, out of quota, or unreachable |
| Upload limits | ebook and import file size |
| Inactive accounts | delete after N days, warn M days before |
| Admin portal | deletion grace period |

**Precedence:** database (set in the portal) → env var → built-in default. Each
setting shows where its value comes from, and "Use env" removes the override.
Changes apply immediately; a half-configured setup (say an SMTP host without a
sender) is refused with a message instead of being saved.

**Secrets** are encrypted at rest (AES-256-GCM, key derived from
`SETTINGS_ENCRYPTION_KEY`) and are never sent back to the browser: the page only
knows whether one is set. If the encryption key changes, stored secrets can't be
read and must be entered again (the page says so). Changing a secret, or anything
under single sign-on, asks for a fresh password + code check first.

**Instance id.** Every installation has a permanent random id, `INSTANCE_UUID`, stored in
`app_settings`. It is created automatically, by the migration for upgrades and by the schema
for new installs (and again on start if the row was ever removed), whether or not the portal
is on. It is shown under *Overview* and *Settings* and can't be edited; it exists so an
installation can be recognised in the future.

**Not editable here**, because they are needed before the database is reachable or
only take effect at start-up: the database connection, ports, `JWT_SECRET`, proxy
trust, CSP-related flags, `ADMIN_*`, `DEMO_MODE`. They are shown read-only.

How it is wired: setting keys *are* the env var names. `SettingsService.effectiveEnv()`
returns `process.env` with the overrides on top, and the existing env readers
(`MailService.readConfig`, ...) run on that. So "configured by env" and "configured by
the portal" are one code path.

## Accounts, vaults and deletions

**Accounts** can be searched and filtered (active, awaiting approval, disabled,
deletion scheduled, unverified). Per account an admin can approve a new registration,
disable or re-enable, sign out everywhere, remove two-factor (lost phone), and delete.

**Vaults** show members, size and plan. An admin can suspend one (its members can no
longer open it until it is restored), assign a plan, or delete it.

**Deleting is two-step on purpose.**

1. Requesting a deletion needs a fresh password + code check and typing the account's
   username (or the vault's name). The account is locked out, or the vault suspended,
   straight away.
2. The real deletion happens after the grace period (*Settings > Admin portal*,
   default 7 days; 0 = immediately). Until then, *Deletions* can cancel it and
   everything is exactly as it was.

An hourly background pass carries out the ones that came due. "Delete right now" skips
the wait. Deleting an account deletes the libraries only that account belongs to; if
it is the only admin of a vault it shares, the deletion is refused with an explanation
(the same rule as a user deleting their own account).

## Plans and quotas

*Plans & quotas* defines tiers with limits on books, members and storage (empty =
unlimited). A vault uses the plan assigned to it, or the default plan, or no limit.

- Enforced when a vault **adds**: a book (manually, by ISBN, or by import), a member
  request, an ebook file. A vault already over a lowered limit keeps what it has.
- Enforced **only while the portal is enabled**.
- There is no billing. Plans are assigned by hand. Payment integration is out of scope.

## Security, logs and audit

*Security* shows, for this server since it started and for the last 30 days:

- requests per minute (OK / 4xx / 5xx / rate limited) and the busiest addresses;
- security events grouped per address and minute: rate-limit hits, failed logins,
  locked accounts, failed admin logins, requests from blocked addresses;
- accounts currently locked out (with an unlock button), live sessions of all
  accounts (with an end button), and an **IP blocklist** that refuses addresses on
  both the app and the portal.

> **About DDoS.** The app can show a flood and who is behind it, and refuse addresses
> you block, but it cannot absorb a real distributed attack. That has to be stopped in
> front of it: a CDN such as Cloudflare, your reverse proxy, or the firewall. Treat this
> page as the dashboard, not the shield.

Recording is cheap by design: events are aggregated in memory per (type, address,
minute) and flushed in batches, so an attack costs a few rows, not one write per request.

*Logs* has the accounts' sign-in activity (`activity_log`), **the emails sent to users**
and the tail of the server log file. The mail log shows when, to whom, which subject
(verification link, approval, deletion warning, vault request, test email) and whether
the SMTP server accepted it or why it refused. It never stores the message itself, since
those carry verification links; entries are kept 90 days. Both can contain user names and addresses; they are admin-only.

*Audit trail* records every admin action: who, what, to what, from which address,
and details. **The database refuses to update or delete these rows** (triggers on
`admin_audit_log`), so it can't be rewritten from the portal. Secrets are never put in
it, only which settings changed.

## Admin accounts

- **Roles.** `superadmin` can change things; `readonly` can only look (useful for
  support staff or an auditor).
- **Two-factor is mandatory.** A new admin enrols at first login (QR code + confirm a
  code) and receives one-time backup codes.
- **Fresh verification.** Dangerous actions (deleting, resetting two-factor, secrets,
  managing admins) need the password and a code again; that unlocks them for 5 minutes.
  The console prompts for it by itself.
- **Lockout.** 5 wrong passwords or codes lock an admin for 15 minutes.
- **Protection against self-inflicted damage.** You can't disable, demote or delete
  yourself, nor remove the last active superadmin.

**Locked out?** Reset from the command line (needs access to the server):

```bash
docker compose exec -it app node index.js admin:reset --email you@example.com
```

That sets a new password and removes two-factor; you enrol again at next sign-in.

## Securing it

- Put it on its own domain over HTTPS, set `ADMIN_URL` to that origin. Requests from
  any other origin are refused.
- Don't publish `ADMIN_PORT` to the internet. The compose file binds it to
  `127.0.0.1`; reach it through a reverse proxy, tunnel or VPN.
- Better still, restrict who can reach it: `ADMIN_ALLOWED_IPS`, or your proxy's
  access rules (Cloudflare Access, VPN, ...).
- Set `SETTINGS_ENCRYPTION_KEY` to a dedicated random value and keep it stable.
- `TRUST_PROXY=true` behind a proxy (and only then), or every client looks like the
  proxy to the rate limiter and the blocklist.
- Keep the number of superadmins small; give everyone else `readonly`.

## Environment variables

Only these stay env-only for the portal:

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_ENABLED` | `false` | Run the portal at all |
| `ADMIN_PORT` | `3001` | Port of the admin listener (must differ from `API_PORT`) |
| `ADMIN_URL` | empty | Public origin of the console, for origin checks |
| `ADMIN_ALLOWED_IPS` | empty | Comma-separated client IPs allowed to reach it |
| `SETTINGS_ENCRYPTION_KEY` | derived from `JWT_SECRET` | Key encrypting secrets saved in the portal |

Command line: `node index.js admin:create --email <e> [--name <n>]`,
`node index.js admin:reset --email <e>` (`ADMIN_PASSWORD` for non-interactive use).

## API map

Everything is under `/api/admin` on the admin port and needs an admin session except
`/auth/login`, `/auth/2fa` and `/auth/enroll/*`. Types are in
`packages/types/src/admin/IAdmin.ts`, the client in
`packages/api-client/src/AdminApiClient.ts`; the routes are in `server/src/admin/routes/`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/2fa`, `/auth/enroll/start`, `/auth/enroll/confirm`, `/auth/reauth`, `/auth/password`, `/auth/logout`; `GET /auth/me` |
| Overview | `GET /overview`, `GET /system` |
| Settings | `GET/PUT /settings`, `POST /settings/test-email` |
| Accounts | `GET /users`, `GET /users/:id`, `POST /users/:id/{approve,disable,enable,force-logout,reset-2fa}`, `DELETE /users/:id` |
| Vaults | `GET /vaults`, `GET /vaults/:id`, `POST /vaults/:id/{suspend,unsuspend}`, `PUT /vaults/:id/plan`, `DELETE /vaults/:id` |
| Plans | `GET/POST /plans`, `PUT/DELETE /plans/:id`, `PUT /plans/default` |
| Deletions | `GET /deletions`, `POST /deletions/:id/{cancel,execute}` |
| Security | `GET /security/{summary,traffic,events,top-ips,lockouts,blocked-ips,sessions}`, plus unlock, block/unblock, end session |
| Logs | `GET /logs/{activity,server,audit}` |
| Admins | `GET/POST /admins`, `PATCH/DELETE /admins/:id`, `POST /admins/:id/reset-2fa` |

## Development

```bash
npm run dev:server      # API on :3000 and, with ADMIN_ENABLED=true in server/.env, the portal on :3001
npm run dev:admin       # the console on http://localhost:5174, proxying /api/admin to :3001
```

The tests live in `server/test/routes/AdminPortal.test.ts` (the portal on),
`AdminDisabled.test.ts` (the portal off must change nothing) and
`server/test/admin/AdminUnits.test.ts`. Schema changes are in
`assets/db/upgrade/1.4.0.sql` and `assets/db/databaseSchema.sql`.
