# Vaultisse

**The easiest way to track, organize, and share all your books.**

Vaultisse is an open-source web application for managing physical book collections —
at home, in a school library, or in a small lending library. It tracks where each book
lives, who currently has it on loan, and its full catalog metadata (author, category,
language, format, cover image), and it can look books up automatically by ISBN.

- **Website:** [vaultisse.com](https://vaultisse.com)
- **Live demo (read-only):** [demo.vaultisse.com](https://demo.vaultisse.com) — log in with
  `demo@vaultisse.com` / `VaultisseDemo!2026`
- **License:** [MIT](LICENSE)

<p align="center">
  <img src="assets/screenshots/dashboard.png" alt="Vaultisse dashboard" width="80%"><br>
  <img src="assets/screenshots/library.png" alt="Vaultisse library view" width="80%">
</p>

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
  - [Client (frontend)](#client-frontend)
  - [Server (backend)](#server-backend)
  - [How they talk to each other](#how-they-talk-to-each-other)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Clone the repository](#1-clone-the-repository)
  - [2. Set up the database](#2-set-up-the-database)
  - [3. Configure the server](#3-configure-the-server)
  - [4. Run the server](#4-run-the-server)
  - [5. Run the client](#5-run-the-client)
- [Building for production](#building-for-production)
- [Deploying with PM2](#deploying-with-pm2)
- [Deploying with Docker](#deploying-with-docker)
- [Releasing a new version](#releasing-a-new-version)
- [Internationalization](#internationalization)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## Features

- Add books manually or by scanning/typing an ISBN (auto-filled via the Google Books
  API, falling back to Open Library and then LibraryThing for the cover when no match
  is found)
- Look up a cover for a book already in the library that's missing one, using the same
  Google Books → Open Library → LibraryThing fallback
- Track individual physical copies ("stock") of a book independently — each copy has
  its own status: available, booked/on loan, damaged, or not available
- Record who a book is currently lent to, using a customer/borrower directory
- Organize books by category, author, language, and format
- Organize physical copies by shelf/location, so you always know where to find them
- Print barcode/ISBN labels for shelving and quick re-scanning
- Full-text search across the catalog
- A dashboard with collection statistics and charts
- Multi-language UI (English, Spanish, Catalan, Italian, French, German)
- Built-in `/docs` help pages, rendered from Markdown, in the same languages
- Cookie/session-based authentication with JWT, password hashing, optional OIDC/SSO
  (Authentik and other IdPs), rate limiting, and secure HTTP headers out of the box

## Architecture

Vaultisse is a classic **SPA + REST API** monorepo: a Vue 3 single-page app talks to
an Express/PostgreSQL backend over a JSON API. In production the backend also serves
the built frontend, so the whole app runs as a single Node.js process behind one port.

```
┌─────────────────────────┐        HTTPS / cookies        ┌──────────────────────────┐
│  client/  (Vue 3 SPA)   │ ─────────────────────────────▶ │  server/ (Express API)  │
│  Vuetify UI components  │ ◀───────────────────────────── │  JWT auth, business      │
│  built with Vite        │        JSON over /api/rest     │  logic, PostgreSQL       │
└─────────────────────────┘                                └────────────┬─────────────┘
                                                                         │
                                                                         ▼
                                                              ┌────────────────────┐
                                                              │   PostgreSQL DB    │
                                                              └────────────────────┘
```

### Client (frontend)

Located in [`client/`](client). A Vue 3 + Vuetify 3 single-page application built with
Vite.

- **`src/views/`** – one folder per feature area (book, authors, categories, customers,
  locations, dashboard, search, settings, docs, legal). Each contains the page-level
  Vue components for that feature.
- **`src/controller/`** – view controllers that hold page state/logic and call
  services, keeping `.vue` files focused on markup (`BaseController.ts` is the shared
  base class).
- **`src/service/`** – one service per resource (book, author, categories, customers,
  locations, dashboard, search, user). Services wrap the HTTP calls to the backend
  API (`ApplicationService.ts` is the shared Axios wrapper, configured in
  `src/plugins/axiosInstance.ts`).
- **`src/model/`** – TypeScript classes/interfaces mirroring the domain entities
  (book, author, category, customer, location, format, language, user).
- **`src/router/`** – Vue Router setup; each feature has its own route file under
  `src/router/routes/`.
- **`src/plugins/i18n/`** – Vue I18n configuration and the generated label map used
  for translations (labels themselves are stored in the database — see
  [Internationalization](#internationalization)).
- **`src/components/`** – shared/reusable UI components (dialogs, tables, pickers,
  the barcode/ISBN scanner, label printing, etc.).

The client is served under the `/app` base path (see `vite.config.ts` and
`router/Router.ts`) and never talks to the database directly — everything goes
through the REST API at `/api/rest/*`.

### Server (backend)

Located in [`server/`](server). A Node.js + Express + TypeScript REST API backed by
PostgreSQL.

- **`src/index.ts`** – process entry point; boots the singleton `AppService`.
- **`src/AppService.ts`** – the application core. Owns the Express app, the
  PostgreSQL connection pool (`pg.Pool`), configuration read from environment
  variables, the logger, and helpers for JWT sessions and password hashing
  (bcrypt). It also wires up global middleware: `helmet` (secure headers),
  `express-rate-limit` (brute-force/DoS mitigation), `cors` (restricted to the
  configured frontend origin), and cookie/body parsing.
The API is layered `types/ → repositories/ → services/ → controllers/ → routes/`,
one set of files per resource (books, authors, categories, locations, loans,
dashboard, customer, import, app, user, auth, ...):

- **`src/routes/`** – one Express router per resource, registered in `Routes.ts`
  under the `/api/rest` prefix: `AppRoute`, `BooksRoute`, `LocationRoute`,
  `CustomerRoute`, `AuthorRoute`, `CategoriesRoute`, `UserRoute`, `DashboardRoute`.
  `AuthRoute` is mounted separately at the root (`/`) and handles login, register,
  logout, OIDC/SSO, and serving the built SPA in production. Routes do nothing but
  wire `middleware → controller.method` for each path — no business logic.
- **`src/controllers/`** – thin HTTP↔service glue: parse the request, call a
  service, map the result (or a thrown `DomainError`) to a response. No SQL, no
  business rules.
- **`src/services/`** – business logic and orchestration. Pure functions of
  `(pool, ...domain args) → domain result` (no Express types), calling one or
  more repositories and throwing a typed `DomainError` subclass (see
  `src/errors/DomainError.ts` — `NotFoundError`, `ConflictError`,
  `ValidationError`, `ForbiddenError`, `UnauthorizedError`, `NotAcceptableError`)
  for expected failures.
- **`src/repositories/`** – data access behind plain exported functions taking
  `Pool | PoolClient` as the first argument: one focused SQL statement each, or
  (for `BookMetadataRepository.ts`/`OidcRepository.ts`) a call to an external
  API/IdP. `withTransaction.ts` wraps a `BEGIN`/`COMMIT`/`ROLLBACK` around a
  callback for the handful of endpoints that write across more than one query.
- **`src/middlewares/AuthMiddleware.ts`** – `requireAuth`/`requireAuthPage`
  guards. Verify the JWT stored in the `token` cookie, check the user still
  exists and isn't disabled, check the session hasn't been individually
  revoked, and silently refresh the cookie when it's close to expiry — see
  [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md). In development, setting
  `ALLOW_DEV_AUTH=true` bypasses login with a fake session — never enable
  this in production.
- **`src/types/`** – one file per resource holding the interfaces its
  repositories return (plus the pre-existing book/stock shapes, search filters,
  and app error types).
- **`src/utils/Logger.ts`** – lightweight file logger (`LOGGER_PATH` env var).
  `src/utils/` otherwise holds small dependency-free helpers (two-factor auth,
  file-signature/ISBN validation, session-cookie option builders) used by the
  layers above but not tied to any one resource.
- **`src/assets/`** – static assets shipped with the API: the standalone
  `login.html`/`register.html` pages, background image, and (in production) the
  built client bundle served from `assets/app`.

Authentication is a JWT in an httpOnly cookie, but not purely stateless:
`requireAuth` also checks a per-user `token_version` counter (bumped on
password change, invalidating every device at once) and a per-login
`user_sessions` row (so "log out this device" in Settings can revoke just
one), on every protected request. Passwords are hashed with bcrypt (12 salt
rounds) and never stored or logged in plaintext. See
[docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) for the full session/revocation model.

### How they talk to each other

- In **development**, Vite runs its own dev server (`npm run dev` in `client/`) and
  proxies any request to `/api/rest/*` to the API (`http://localhost:<API_PORT>` by
  default, see `vite.config.ts`). The API runs separately via `npm run dev` in
  `server/` (nodemon + ts-node).
- In **production**, the client is built into static files and the Express server
  serves them directly (see `AuthRoute.ts`, which serves `index.html` for `/app` and
  `/app/*`, guarded by `requireAuth`) — there is a single process and a single port.

For deeper dives into specific parts of the codebase (not to be confused with
the in-app `/docs` help pages, which are end-user-facing), see
[docs/](docs/README.md).

## Project structure

```
vaultisse/
├── client/                # Vue 3 + Vuetify frontend (see client/README.md)
│   └── src/
│       ├── views/         # Page components, grouped by feature
│       ├── controller/    # Page controllers (state + logic)
│       ├── service/       # API clients, one per resource
│       ├── model/         # Domain TypeScript models
│       ├── router/        # Vue Router configuration
│       ├── components/    # Shared UI components
│       └── plugins/       # i18n, Vuetify, Axios setup
├── server/                # Express + TypeScript REST API
│   └── src/
│       ├── routes/        # One Express router per resource
│       ├── middlewares/   # requireAuth (JWT) middleware
│       ├── types/         # Shared TypeScript types
│       ├── utils/         # Logger, etc.
│       └── assets/        # Static login/register pages, prod client bundle
├── assets/
│   ├── db/                # SQL schema (databaseSchema.sql) + upgrade/ (dated upgrade files)
│   └── pm2/               # Sample PM2 ecosystem config for production
├── build.sh               # Builds client + server into ./dist and zips it
└── LICENSE
```

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 22.x and npm 10.x (used to develop this project;
  other recent LTS versions likely work but aren't tested)
- [PostgreSQL](https://www.postgresql.org/) 13+ (any recent version should do)
- A [Google Books API key](https://developers.google.com/books) (optional — the
  server looks up ISBNs on [Open Library](https://openlibrary.org/developers/api)
  first; a key only adds Google Books on top)
- A [LibraryThing developer key](https://www.librarything.com/services/keys.php) (optional,
  free with any LibraryThing account — used as a third cover-lookup fallback when neither
  Google Books nor Open Library has one; skipped entirely if `LIBRARYTHING_API_KEY` isn't set)

### 1. Clone the repository

```bash
git clone https://github.com/AlbertAmat/vaultisse.git
cd vaultisse
```

### 2. Set up the database

Create a PostgreSQL database and load the schema — `databaseSchema.sql` is always
kept up to date, so this is everything a new install needs:

```bash
createdb vaultisse
psql -d vaultisse -f assets/db/databaseSchema.sql
```

> There is no admin UI for the very first user, and none is needed: `/register` is a
> normal, always-available page regardless of `ALLOW_DEV_AUTH` (see `AuthRoute.ts`) —
> after loading the schema, just start the server and register through it like any
> other account. Inserting a row into `users` directly is only useful if you want to
> skip that page entirely.

The version-named files in `assets/db/upgrade/` (`1.0.0/1.sql`, `1.0.0/2.sql`,
...) are **not** for new installs — they're incremental upgrades for a
database that's already running an older version of the schema (see
[`assets/db/upgrade/README.md`](assets/db/upgrade/README.md) for the full
convention). If you're upgrading an existing instance instead of setting one
up fresh, you don't need to touch these yourself: the server applies
whatever it's missing automatically on startup (`npm run dev`/`npm start`),
however far behind it is, and records what it's applied so it's never
redone. Manually running one of these files is only for recovery/debugging —
see that directory's README for how.

### 3. Configure the server

Create `server/.env` (this file is git-ignored) with:

```dotenv
API_PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=vaultisse
DB_USER=your_db_user
DB_PASSWORD=your_db_password
GOOGLE_BOOKS_API_KEY=            # optional, see Prerequisites
LIBRARYTHING_API_KEY=            # optional, see Prerequisites
LOGGER_PATH=./logs.log
FRONT_END_URL=http://localhost:5173
JWT_SECRET=replace_with_a_long_random_string
SESSION_TIME=3600000             # milliseconds
ALLOW_DEV_AUTH=false             # NEVER true in production
```

Generate a strong `JWT_SECRET`, for example: `openssl rand -hex 32`.

### 4. Run the server

```bash
cd server
npm install
npm run dev      # starts the API with nodemon on API_PORT
```

### 5. Run the client

```bash
cd client
npm install
npm run dev       # starts Vite; proxies /api/rest to the server
```

Open the URL Vite prints (typically `http://localhost:5173/app`) in your browser.

## Building for production

From the repository root:

```bash
./build.sh
```

This installs dependencies, builds the client (Vite) and server (`tsc`), assembles
everything under `./dist` (`dist/client`, `dist/server`), copies server assets, and
produces a deployable `dist.zip`. The server serves the built client itself, so a
single Node.js process is all you need to run in production.

## Deploying with PM2

A sample [PM2](https://pm2.keymetrics.io/) config is provided at
`assets/pm2/ecosystem.config.js.sample`. Copy it, fill in your production values
(database credentials, `JWT_SECRET`, `FRONT_END_URL`, etc.), and run:

```bash
cp assets/pm2/ecosystem.config.js.sample ecosystem.config.js
# edit ecosystem.config.js with your production values
pm2 start ecosystem.config.js --env production
```

## Deploying with Docker

Every push of a `vX.Y.Z` tag builds a production image and publishes it to GitHub
Container Registry at `ghcr.io/albertamat/vaultisse` (see
[Releasing a new version](#releasing-a-new-version)). The image bundles the compiled
server and the built client into one process, same as the PM2 deployment above — there
is no separate frontend container.

To run it on a server with Docker installed:

```bash
mkdir -p assets/db
curl -O https://raw.githubusercontent.com/AlbertAmat/vaultisse/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/AlbertAmat/vaultisse/main/.env.example
curl -o assets/db/databaseSchema.sql https://raw.githubusercontent.com/AlbertAmat/vaultisse/main/assets/db/databaseSchema.sql
cp .env.example .env
# edit .env: set JWT_SECRET, DB_PASSWORD, FRONT_END_URL, etc.
docker compose up -d
```

This starts two containers: `db` (PostgreSQL, seeded from
`assets/db/databaseSchema.sql` — the file fetched above — on first run) and `app`
(the image above). `docker-compose.yml` mounts that file by its relative path, so it
must exist at `assets/db/databaseSchema.sql` next to the compose file, not just be
present somewhere in the clone. Pin `APP_TAG` in `.env` to a specific released version
rather than `latest` if you want upgrades to be a deliberate step.

Once `app` is up, open `FRONT_END_URL` and go to `/register` to create your first
account — it's a normal, always-available page, not gated by `ALLOW_DEV_AUTH` (which
should stay `false`, see below). There's no separate admin role; every account has the
same access.

A few things worth knowing before pointing this at a real server:

- **Upgrading is just bumping `APP_TAG` and re-running `docker compose up -d`.**
  The `app` container applies any pending schema changes itself on startup (see
  [`assets/db/upgrade/README.md`](assets/db/upgrade/README.md)) — no manual `psql`
  step, regardless of how far behind it is.
- **`ALLOW_DEV_AUTH` must stay `false`.** It bypasses login with a fake session and
  exists only for local development.
- **`DB_HOST`/`DB_PORT` in `.env` are ignored for the `app` container** — it always
  connects to the `db` service on the compose network. They only configure the `db`
  container itself.
- **Logs** are written to `/app/logs` inside the container (`LOGGER_PATH`), persisted
  via the `app-logs` volume.
- To build and run the image locally instead of pulling it:
  `docker build -t vaultisse .`

To build a multi-arch image or push to a different registry, adjust
`.github/workflows/docker-release.yml`.

For step-by-step instructions covering local-only self-hosting, production behind
your own reverse proxy/DNS, production behind Cloudflare Tunnel, and a one-click
**Unraid** template (Docker tab → Add Container, no Compose needed), see
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Releasing a new version

The repository root has a `package.json` that exists solely to anchor the release
version (the client and server aren't published packages and keep their own internal
version fields). To cut a release:

```bash
npm version patch   # or: minor / major
git push --follow-tags
```

`npm version` bumps `package.json`, commits it, and creates a `vX.Y.Z` git tag.
Pushing that tag triggers `.github/workflows/docker-release.yml`, which builds the
Docker image, pushes `ghcr.io/albertamat/vaultisse:X.Y.Z` and `:latest`, and creates
a matching GitHub Release with auto-generated notes.

The running app version is available at `GET /api/rest/app/version` (unauthenticated),
useful for confirming what's actually deployed.

The first time you release, open the new package under **Packages** on the GitHub repo
and set its visibility (packages default to private) so `docker pull` works without
authentication on your server.

## Internationalization

The UI currently ships in English, Spanish, Catalan, Italian, French, and German. Labels are stored
in the database (`app_languages` / `app_labels` tables in `databaseSchema.sql`) and
loaded into the client's Vue I18n instance — this keeps translations editable
without a redeploy. The `/docs` help pages are Markdown files rendered per-language
in the client. See [Contributing](#contributing) for how to add a new language.

## Roadmap

Looking for ways to contribute? [docs/ROADMAP.md](docs/ROADMAP.md) lists feature ideas
that don't have anyone working on them yet — Kindle/Kobo sync, SSO, an admin
panel, library sharing for families, and more.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for how to
set up your environment, coding conventions, and how to submit a pull request. All
participants are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please **do not** open a public issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for how to report them responsibly.

## License

This project is licensed under the [MIT License](LICENSE).

## Topics

books reading organization tracking lending library collection management
open-source inventory personal-library cataloging
