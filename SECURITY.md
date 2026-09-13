# Security Policy

## Supported Versions

Vaultisse does not yet have tagged releases; security fixes are applied to the
`main` branch. Please always run the latest commit on `main` in production.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report it privately using [GitHub's private vulnerability reporting]
(../../security/advisories/new) on this repository. If that isn't available,
open a regular issue asking a maintainer to contact you privately, without
including any exploit details.

When reporting, please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof of concept
- The affected component (client, server, database schema, deployment config)
- Any suggested mitigation, if you have one

We will acknowledge your report as soon as possible, investigate, and keep you
updated as we work on a fix. Once a fix is released, we will credit reporters
who wish to be credited.

## Scope and known sensitive areas

Given the app's architecture, reports about the following areas are especially
appreciated:

- Authentication and session handling (`server/src/routes/auth/AuthRoute.ts`,
  `server/src/middlewares/AuthMiddleware.ts`) — JWT issuance/verification,
  cookie flags, password hashing, session revocation. See
  [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) for how this is all meant to work,
  as a reference point for what a "wait, that's not right" looks like.
- Authorization on REST endpoints under `server/src/routes/`
- SQL injection in any query against the PostgreSQL pool
- The `ALLOW_DEV_AUTH` development bypass — it must never be reachable when
  `ALLOW_DEV_AUTH` is unset/false, and documentation should never encourage
  enabling it outside local development
- Secure headers / CSP configuration in `server/src/AppService.ts`
- Handling of uploaded files (`multer`) and served static assets

## Out of scope

- Vulnerabilities that require an attacker to already have valid database or
  server credentials
- Issues in third-party dependencies without a demonstrated impact on
  Vaultisse itself (please report those upstream as well)
