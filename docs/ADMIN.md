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
- [Minimum configuration](#minimum-configuration)
- [Environment variables or the console: which wins](#environment-variables-or-the-console-which-wins)
- [The setup guide](#the-setup-guide)
- [How it is built](#how-it-is-built)
- [What it can and can't see](#what-it-can-and-cant-see)
- [Settings without env vars](#settings-without-env-vars)
- [Accounts, vaults and deletions](#accounts-vaults-and-deletions)
- [Plans and quotas](#plans-and-quotas)
- [Announcements and maintenance mode](#announcements-and-maintenance-mode)
- [Emailing the users](#emailing-the-users)
- [Inactive accounts: who is deleted next](#inactive-accounts-who-is-deleted-next)
- [Bulk actions on accounts](#bulk-actions-on-accounts)
- [Terms acceptance report](#terms-acceptance-report)
- [Automatic IP blocking](#automatic-ip-blocking)
- [Login map](#login-map)
- [Compliance](#compliance)
- [System page](#system-page)
- [Notifications to admins](#notifications-to-admins)
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

## Minimum configuration

With the console you only need the variables that must exist *before* the database can be
reached or that decide where and how the server runs. Everything else is set in the console.
`.env.minimal.example` is a ready-to-copy file with exactly these:

| Variable | Why it can't live in the console |
|---|---|
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | The server needs the database to read any saved setting. (With the compose file, `DB_HOST` and `DB_PORT` are set for you.) |
| `JWT_SECRET` | Signs sessions; needed before anything runs. `openssl rand -hex 32` |
| `FRONT_END_URL` | The address users open: used for CORS, security headers and the links in emails, all fixed at start-up. Defaults to `http://localhost:<API_PORT>` with a warning. |
| `ADMIN_ENABLED=true` | Switches the console on. |

Strongly recommended: `ADMIN_URL` (the console's own address, so other origins are refused),
`SETTINGS_ENCRYPTION_KEY` (a dedicated key for the secrets you save), and, when relevant,
`TRUST_PROXY=true` behind a reverse proxy or `ALLOW_HTTP=true` on plain HTTP.

Optional with safe defaults: `API_PORT` (3000), `ADMIN_PORT` (3001), `SESSION_TIME` (1 hour),
`LOGGER_PATH`. **Everything else** (SMTP, registration and approval, single sign-on, API keys,
upload limits, inactive-account deletion, notifications) can be left out of `.env` and set in
the console.

## Environment variables or the console: which wins

**The console wins.** For every setting the value used is, in order: what is saved in the
console, then the environment variable, then the built-in default. So if you configured
`SMTP_HOST` in `.env` and later change it in the console, the console's value is used and the
environment variable is ignored. (Settings that exist only as environment variables, such as the
database connection, are unaffected: the console can't edit them.)

You can always see which applies:

- **In the container output at every start**, a table of each setting that is configured anywhere:

  ```
  SETTING                  ENV VAR          ADMIN PANEL      APPLIED      NOTE
  SMTP_HOST                smtp.old.com     smtp.new.com     admin panel  env var IGNORED (the admin panel overrides it)
  REGISTRATION_ENABLED     true             -                env var
  REGISTRATION_REQUIRES_.. -                true             admin panel
  MAX_IMPORT_FILE_SIZE_MB  20               50               admin panel  env var IGNORED (the admin panel overrides it)

  2 environment variables are being ignored because the admin panel sets those values.
  ```

  Secrets are never printed, only "(set)". With the portal off, nothing is printed because only
  the environment applies.
- **In Settings**, a setting that overrides an environment variable says so under the field
  ("The environment variable ... is ignored while this is set here"), and "Use env" removes
  just that override.

### Danger zone: go back to the environment variables

*Settings > Danger zone > Reset configuration* removes **every** setting saved in the console,
so the environment variables apply again at once. Accounts, vaults, plans, admins and logs are
untouched; features configured only in the console (say email) switch off. It takes three
steps, because it can't be undone:

1. A fresh password + code check (as for any dangerous action).
2. A confirmation dialog where you type `RESET`.
3. A one-time **code emailed to your admin address** (6 digits, valid 10 minutes, works once,
   locked after five wrong tries), which you type back.

It is recorded in the audit trail and emailed to the admins (security notifications). If email
isn't set up there is nobody to send the code to, so use the command line instead, which needs
shell access to the server (that access already is the authority):

```bash
docker compose exec -it app node index.js config:reset      # asks you to type RESET
```

Restart the server afterwards so it reloads the environment.

## The setup guide

The first time a superadmin gets into the console, a short guide opens on top of it, so nothing
has to be found in the menu: **Welcome** (it lists what the environment already configured),
**Email** (with a test button that tries the values before you save), **Sign-up** (who can
register, and whether you approve accounts), **API keys** (optional, each with a test),
**Alerts** (which problems to be emailed about) and **Done** (a summary). Every step can be
skipped, and "Skip the guide" closes it for good. It appears once per installation, and
*Settings > Run the setup guide* opens it again.

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
| Admin portal | deletion grace period, version check on/off |
| Notifications | which events email the admins (edited on the Notifications page) |

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

## Announcements and maintenance mode

*Announcements* puts a banner at the top of the app (and on the login and register pages) for every
user: "Maintenance tonight at 22:00", a new feature. Each has a look (information and warning can be
dismissed by the user; critical stays), a start and an optional end, so you can schedule it and forget
it, and can be switched off or edited at any time. Text is shown as you write it (it isn't translated).

**Maintenance mode** makes the whole app read-only. Every request that would change something (adding
or editing books, lending, uploads, registering) is refused with `503` and your message, which also
shows as a dark banner for everybody. Reading and signing in keep working, and the admin console is not
affected. Turning it on needs a fresh password + code check, since it affects every user. The state is
stored separately from the editable settings, so a configuration reset doesn't end it. While the portal
is off none of this applies.

The app reads `GET /api/rest/app/notice` (public, always empty with the portal off) on load, every two
minutes and when the tab regains focus.

## Emailing the users

*Email users* sends a plain-text message to the people who use the app, for things that can't wait for
their next visit: a closure, new terms, a security notice.

1. **Pick the audience:** everyone, vault admins, accounts active in the last 30 days, or accounts without
   two-factor. Only enabled accounts with a verified email are ever addressed.
2. **Write** a subject and message. `{name}` is replaced by each person's name.
3. **Preview** shows the exact recipient count, a few masked addresses and the email as it will read.
   *Send a test to me* delivers it to your own address first.
4. **Send** needs a fresh verification and a confirmation that repeats the count you saw; if the audience
   changed since the preview, it refuses and shows the new number.

Emails go out one by one in the background (a gentle pace, so the mail server isn't flooded). Progress
shows live, it can be stopped (what was already sent stays sent), and only one broadcast runs at a time.
One that was cut off by a restart is marked *Interrupted*. History keeps what was sent and how it went;
every email also appears in *Logs > Emails sent*. A footer says it is a service message about their account.

## Inactive accounts: who is deleted next

If automatic deletion of inactive accounts is on (*Settings > Inactive accounts*), accounts nobody used for
N days are deleted, after an email warning M days before. *Deletions > Inactive accounts* shows who that
affects so nobody is surprised: those **to be warned next**, **already warned** (and when they'll be
deleted), those **deleted at the next daily run**, and who is **coming up** within 7, 14, 30 or 90 days.

- **Keep** counts an account as active now: its clock restarts and a warning is cancelled.
- **What if** previews another period ("what if I set it to 90 days?") without changing anything. It works
  even while the feature is off, so you can see the effect before turning it on.
- The rules are those of the real job: accounts that can't sign in anyway, borrowers with copies still on
  loan, and the only admin of a vault shared with others are never deleted, so they are never listed.

## Bulk actions on accounts

In *Accounts*, tick several rows (or the box in the header) and a bar offers **Approve, Disable, Enable,
Sign out** and **Delete**. With the *Awaiting approval* filter on, **Approve all N** handles everyone
waiting in one go. Each account is handled on its own with its own audit entry (plus one summary entry);
one that can't be changed (already approved, a deletion is scheduled...) is reported and the rest carry on.
Deleting needs a fresh verification and typing `DELETE`, and goes through the normal grace period, so it
can still be cancelled. Up to 500 accounts per action.

## Terms acceptance report

*Terms & notices* shows, for the Terms of Service and the security notice, how many accounts accepted, were
asked but haven't answered, or haven't been asked yet (usually: not signed in since it was introduced), with
the list per account, search, and an **Export CSV** of the current filter. The CSV opens safely in a
spreadsheet (cells that start with `=`, `+`, `-` or `@` are neutralised).

## Automatic IP blocking

*Security > Blocked addresses > Automatic blocking* (off by default) blocks an address that keeps failing to
sign in: after N failed logins within M minutes (defaults 20 within 10), for H hours (default 24). It counts
failed user logins, locked accounts, failed admin logins and the attempts the login rate limiter refuses
(the limiter stops an address after 5 tries per 5 minutes, so those refusals are what a determined attacker
mostly produces). A block is recorded in the audit trail, emailed to the admins, and shows as *auto* in the
list; unblock it any time.

Because a wrong block would lock real people out, it **never** blocks:

- private, loopback or link-local addresses (behind Docker or a reverse proxy without `TRUST_PROXY=true`
  every visitor shows up as one such address, and blocking it would block everybody);
- an address from which somebody signed in successfully in the last 24 hours (a shared office address);
- an address on `ADMIN_ALLOWED_IPS`.

Behind a reverse proxy, set `TRUST_PROXY=true` so real visitor addresses are seen.

## Login map

*Login map* shows where people sign in from. It plots the successful sign-ins of the regular users, and the
failed attempts, on an OpenStreetMap, for the last 7, 30, 90 or 365 days. Addresses that resolve to the same
place are merged into one circle; its size is the number of events and it turns red when failed attempts
outnumber sign-ins. Click a circle for the place, the number of sign-ins and accounts, and the last sign-in.
The popup never names a person.

- **Offline lookup.** Addresses are placed with the database bundled in the `geoip-lite` package, on this
  server. No address is sent to any outside service. The only request that leaves is your browser asking
  openstreetmap.org for the map tiles (so the admin CSP allows `tile.openstreetmap.org`).
- **Accuracy.** The country is nearly always right, the city often, never the street. A VPN, a mobile carrier
  or a proxy shows where that network ends. The data is as old as the installed package; update it by
  updating the app.
- **Not placed.** Private and local addresses (`10.x`, `192.168.x`, `127.x`, ...) have no place and are only
  counted. Behind Docker or a reverse proxy without `TRUST_PROXY=true` every visitor looks like one, so set it.
- **Memory.** The database (about 100 MB) is loaded the first time the map is opened, not at start-up.
- **Privacy.** A sign-in address is personal data. The map shows the same information as *Logs > Sign-ins*,
  grouped; mention it in your privacy policy.

## Compliance

*Compliance* helps you prepare the evidence an ISO/IEC 27001 audit (or a GDPR or SOC 2 review) asks for. It is a
working aid: it does **not** certify anything, and passing every check does not make an installation "ISO
certified". Certification covers your organisation, not just this software.

**Controls.** The catalogue holds the ISO/IEC 27001:2022 Annex A controls an installation of this app can
evidence (30 or so), each mapped to the matching GDPR articles and SOC 2 criteria. Two kinds:

- *Measured* controls are checked by the portal from the live configuration and database: admin
  two-factor and access reviews (A.5.17, A.5.18), HTTPS and encryption of secrets (A.8.24), the tamper-proof
  audit trail (A.8.15), alerts to admins (A.8.16), IP allowlist and automatic blocking (A.8.20), update status
  (A.8.8), retention of inactive accounts (A.5.34, A.8.10) and so on. They turn green, amber or red on their
  own, and a measured control can't be turned green by hand: fix the cause. The one thing a person may declare
  is *not applicable*, which needs a written justification.
- *Declared* controls can't be measured (backups, training, physical security, change management). A person
  sets the status (implemented, partly, planned), the owner, the evidence link and the next review.

Click a control for what it asks for, what to keep, and the form. Every change goes to the audit trail. The
**Statement of applicability** button exports a CSV of every control, whether it applies, how it stands and why
(the document ISO/IEC 27001 clause 6.1.3 asks for). The readiness score counts implemented as 1, partly as ½,
and leaves out what doesn't apply.

**Registers.** ISO 27001 wants records, so the page keeps four small registers: *Policies* (version, approval
date, next review), *Suppliers* (criticality, link to the contract or data processing agreement, GDPR art. 28),
*Risks* (risk level, treatment) and *Assets* (owner, criticality). Their review dates feed the controls: a
policy past its review date turns A.5.1 red.

**Incidents.** Record each security incident with severity, what was done and the lessons learned. For a
personal-data breach the page counts the 72 hours GDPR art. 33 gives you to tell the authority, and flags it red
when that time passes without a notification date. Incidents are closed, never deleted.

**Access review.** Confirm every few months that each admin still needs access (A.5.18). Admins never reviewed
or not reviewed for 180 days are flagged. The date and the reviewer are stored on the admin account.

Added to the database for this (all in the v1.4.0 upgrade): `compliance_controls`, `compliance_register`,
`security_incidents`, and `admin_users.access_reviewed_at` / `access_reviewed_by`.

## System page

*System* answers "what am I running and is it healthy":

- **Version.** The installed version (`APP_VERSION`, set by the Docker image) and whether
  a newer release exists, from GitHub's public list of releases (cached 6 hours, "Check
  now" to refresh). Nothing about your installation is sent, and it can be switched off
  (*Settings > Admin portal*). A development build says so instead of guessing.
- **Database.** How the server connects (name, host, port, user, TCP or socket, from the
  environment, never the password), what the database itself reports (its address and
  port, PostgreSQL version, how long it has been up, response time), **its size on disk**,
  connections in use against `max_connections` plus the app's connection pool, and the
  largest tables. The status is *Healthy*, *Needs attention* (nearly out of connections,
  requests waiting, slow answers, over the size limit set for alerts) or *Not reachable*.
- **Database conversions.** Every upgrade step (migration) that was applied and when,
  newest first. The server applies them on its own at start, once each.
- **This server.** Instance id, uptime, Node.js, system, memory, whether it runs in Docker.

## Notifications to admins

*Notifications* is where the console emails its admins, so problems reach you without
anyone watching the console. It needs email to be set up (*Settings > Email*); without it,
events are listed in the history as *not sent*.

| Event | When |
|---|---|
| New account waiting for approval | Someone registers while approval is required (batched: one email per ten minutes, with the count) |
| Unusual security activity | Failed logins, lockouts and rate-limit hits pass a threshold (default 50 in 10 minutes), or three or more failed admin logins |
| Database problems | The database is unreachable, nearly out of connections, or over a size limit you set |
| Emails failing to send | Five or more emails to users refused by the mail server within an hour |
| Accounts and vaults deleted | A scheduled deletion was carried out, or failed |
| A new version is available | A newer release exists (needs the version check) |
| The server started | Every start, with the migrations it applied (off by default) |

Each event can be switched off. The same alert isn't repeated within its cooldown (an
hour for security and an unreachable database, longer for the rest), so a problem that
lasts doesn't fill inboxes. Problems are checked every five minutes. During a database
outage the last known list of recipients is used, since that is when you most need to
hear about it.

Each admin chooses for themselves whether they receive them (a superadmin can also
change it for others); they go to the address used to sign in. *Send me a test* checks
that it reaches you, and *What was sent* lists everything attempted, including what was
skipped and why (90 days). Notification emails also show up under *Logs > Emails sent*.

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
| Communication | `GET/POST /announcements`, `PUT/DELETE /announcements/:id`, `PUT /announcements/maintenance`; `GET /broadcast/audiences`, `POST /broadcast/preview`, `/broadcast/test`, `/broadcast`, `GET /broadcast`, `GET /broadcast/:id`, `POST /broadcast/:id/cancel` |
| Account tools | `POST /users/bulk`; `GET /inactivity`, `POST /inactivity/:id/keep`; `GET /terms/summary`, `/terms/list`, `/terms/export.csv` |
| Settings | `GET/PUT /settings`, `POST /settings/test-email`, `POST /settings/test-key` |
| System | `GET /system`, `GET /system/details`, `POST /system/check-updates` |
| Notifications | `GET /notifications`, `GET /notifications/history`, `PUT /notifications/me`, `PATCH /notifications/recipients/:id`, `POST /notifications/test` |
| Accounts | `GET /users`, `GET /users/:id`, `POST /users/:id/{approve,disable,enable,force-logout,reset-2fa}`, `DELETE /users/:id` |
| Vaults | `GET /vaults`, `GET /vaults/:id`, `POST /vaults/:id/{suspend,unsuspend}`, `PUT /vaults/:id/plan`, `DELETE /vaults/:id` |
| Plans | `GET/POST /plans`, `PUT/DELETE /plans/:id`, `PUT /plans/default` |
| Deletions | `GET /deletions`, `POST /deletions/:id/{cancel,execute}` |
| Security | `GET /security/{summary,traffic,events,top-ips,lockouts,blocked-ips,sessions}`, plus unlock, block/unblock, end session |
| Logs | `GET /logs/{activity,server,audit}` |
| Login map | `GET /map/logins?days=` |
| Compliance | `GET /compliance`, `PUT /compliance/controls/:id`, `GET /compliance/export.csv`, `GET/POST /compliance/register`, `PUT/DELETE /compliance/register/:id`, `GET/POST /compliance/incidents`, `PUT /compliance/incidents/:id`, `GET/POST /compliance/access` |
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
