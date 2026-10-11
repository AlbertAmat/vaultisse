# Developer docs

Deep-dive documentation for people working *on* Vaultisse's code -
contributors, maintainers, whoever's deploying or auditing it. Not to be
confused with the **in-app** `/docs` help pages (`client/src/views/docs/content/`),
which are end-user-facing, translated into four languages, and explain how to
*use* the app rather than how it's built.

Start with the [root README](../README.md) for the project overview and
architecture map; come here for the parts worth a longer explanation than fit
there.

- **[AUTHENTICATION.md](AUTHENTICATION.md)** - the session model: JWTs,
  `token_version`, per-session revocation (`user_sessions`), the audit trail
  (`activity_log`), and how a dying session surfaces on the client.
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - self-hosting: local-only, behind your
  own reverse proxy, behind Cloudflare Tunnel, or the one-click Unraid template.
- **[TESTING.md](TESTING.md)** - running the server's Jest/Supertest suite
  locally, how the dedicated test database and auth helpers work, and the CI
  workflow that runs it on every push/PR.
- **[ROADMAP.md](ROADMAP.md)** - feature ideas that don't have anyone working
  on them yet, for contributors looking for something to pick up.

Module-by-module deep dives, each covering both the `server/src/routes/*.ts`
endpoints and the matching `client/src/{controller,service,views}/` code:

- **[BOOKS.md](BOOKS.md)** - the catalog: books vs. physical stock, the
  stock lifecycle, ISBN auto-lookup (Google Books/Open Library), cover
  images, ebook file backups, and barcode scanning/printing.
- **[CUSTOMERS.md](CUSTOMERS.md)** - borrowers, customer groups, and the
  lending/returning flow.
- **[LOCATIONS.md](LOCATIONS.md)** - shelves/storage locations and moving
  stock between them.
- **[LOANS.md](LOANS.md)** - the currently-on-loan listing and the
  `loan_history` audit/report table behind it.
- **[CATALOG.md](CATALOG.md)** - categories, authors, languages, formats,
  and the `GET /app/policy` bootstrap that delivers them to the client.
- **[DASHBOARD.md](DASHBOARD.md)** - the single aggregate endpoint behind
  the dashboard's KPIs and charts.
- **[SETTINGS.md](SETTINGS.md)** - profile and UI preferences
  (session/password/2FA live in AUTHENTICATION.md instead).
- **[CLIENT-ARCHITECTURE.md](CLIENT-ARCHITECTURE.md)** - the
  controller/service/model pattern shared by every client feature, the
  shared axios instance, routing, and i18n.

`README.md`, `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and
`SECURITY.md` stay at the repo root - GitHub looks for those specific files
there (or gives them dedicated UI - the Security tab, the "healthy
contributing guidelines" banner, and so on), so moving them would make the
project look less maintained to anyone just browsing on GitHub. Everything
else that's prose documentation rather than one of those belongs here.
