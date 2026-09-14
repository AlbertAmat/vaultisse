# Contributing to Vaultisse

Thanks for your interest in contributing! This document explains how to set up the
project locally, the conventions we follow, and how to get a change merged.

By participating in this project you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Project setup](#project-setup)
- [Repository layout](#repository-layout)
- [Coding conventions](#coding-conventions)
- [Commit messages](#commit-messages)
- [Submitting a pull request](#submitting-a-pull-request)
- [Reporting bugs](#reporting-bugs)
- [Suggesting features](#suggesting-features)
- [Adding a new language](#adding-a-new-language)

## Ways to contribute

- Report bugs or unexpected behavior
- Suggest or design new features
- Improve documentation (this file included!)
- Fix bugs or implement features from open issues
- Add or improve translations
- Improve test coverage

If you're not sure whether a change is wanted, open an issue first to discuss it
before investing time in a pull request.

## Project setup

See the [README](README.md#getting-started) for full setup instructions (database,
environment variables, running the client and server). In short:

```bash
# server
cd server
npm install
npm run dev

# client (in another terminal)
cd client
npm install
npm run dev
```

## Repository layout

This is an npm-workspaces-free monorepo with two independent Node projects:

- `client/` — Vue 3 + Vuetify 3 SPA (Vite, TypeScript)
- `server/` — Express REST API (TypeScript, PostgreSQL)

See the [Architecture section of the README](README.md#architecture) for how the
code is organized inside each and how they communicate.

## Coding conventions

- **TypeScript everywhere.** Avoid `any` where a real type is easy to express;
  existing `//@ts-ignore` usages in older code are not a license to add new ones.
- **Follow existing patterns.** The server is layered `types/ → repositories/ →
  services/ → controllers/ → routes/`: `types/<resource>.ts` holds the interfaces
  a repository returns; `repositories/<Resource>Repository.ts` is data access
  (SQL or an external API call) behind plain exported functions taking
  `Pool | PoolClient` as the first argument; `services/<Resource>Service.ts` is
  business logic, throwing a `DomainError` subclass (see
  `server/src/errors/DomainError.ts`) for expected failures and calling only
  repositories, never Express types; `controllers/<Resource>Controller.ts` is
  thin HTTP↔service glue that maps `DomainError` to `res.status(err.httpStatus)`;
  `routes/<Resource>Route.ts` shrinks to wiring
  (`router.verb(path, middleware, controller.method)`) and stays registered in
  `Routes.ts`. New backend resources should follow this same split, mirroring
  the existing resources (books, authors, categories, ...). New frontend
  features should follow the `view/controller/service/model` split already used
  for existing pages.
- **Keep the client thin.** Business logic and data access belong in the server;
  the client should call the REST API rather than talking to the database or
  external APIs (Google Books/Open Library) directly.
- **Security-sensitive code** (auth, password handling, session/cookie logic,
  anything touching `AuthMiddleware.ts` or `AuthRoute.ts`) should be changed
  carefully and called out explicitly in your PR description.
- **Lint:** the server has a `tslint` config (`npm run lint` in `server/`).
  `vue-tsc --build` (`npm run type-check` in `client/`) should pass with no new
  type errors.
- Don't commit `.env` files, real credentials, or personal data/book covers used
  only for local testing.

## Commit messages

Write short, imperative commit messages describing *what* changed (e.g.
`Add ISBN lookup fallback to Open Library`, `Fix stock status not updating on
return`). Group unrelated changes into separate commits/PRs where practical.

## Submitting a pull request

1. Fork the repository and create a branch from `main`:
   `git checkout -b my-feature`
2. Make your change, following the conventions above.
3. Run the relevant checks:
   ```bash
   cd server && npm run lint
   cd client && npm run type-check
   ```
4. Push your branch and open a pull request against `main`. Describe:
   - What the change does and why
   - How you tested it (steps, screenshots for UI changes)
   - Any schema changes (see below) or breaking changes
5. Be responsive to review feedback. Small, focused PRs are easier to review and
   merge quickly than large ones.

### Database schema changes

If your change requires a schema change, add it to **both**:

- `assets/db/databaseSchema.sql` — always current, the only thing a fresh install runs.
- `assets/db/upgrade/X.Y.Z.sql` (or `X.Y.Z/N.sql` if that version needs more than
  one file) — upgrade file for existing installs, named after the version it
  ships in. See [`assets/db/upgrade/README.md`](assets/db/upgrade/README.md)
  for the full convention.

Treat a file under `assets/db/upgrade/` as append-only once it's part of a
release — mention the new/updated file in your PR description.

## Reporting bugs

Open a [GitHub issue](../../issues) with:

- A clear description of the problem and the expected behavior
- Steps to reproduce (and, if relevant, sample data/ISBN)
- Environment details (OS, Node/PostgreSQL versions, browser)
- Relevant logs or console/network errors, with any secrets redacted

For security vulnerabilities, do **not** open a public issue — see
[SECURITY.md](SECURITY.md) instead.

## Suggesting features

Open an issue describing the problem you're trying to solve (not just the
solution) so it can be discussed before implementation starts. This helps avoid
wasted effort on features that don't fit the project's direction.

Check [docs/ROADMAP.md](docs/ROADMAP.md) first — it lists feature ideas that are already
wanted but don't have anyone working on them yet.

## Adding a new language

UI labels live in the `app_languages` / `app_labels` tables (see
`assets/db/databaseSchema.sql`) and are loaded by the client's Vue I18n setup in
`client/src/plugins/i18n/`. To add a language:

1. Insert a row into `app_languages` for the new language code.
2. Add the corresponding `app_labels` rows for every existing `code`, translated.
3. Add translated Markdown files for the `/docs` help pages (see
   `client/src/views/docs/`).
4. Verify the language selector in Settings picks up the new locale.

Thank you for contributing to Vaultisse!
