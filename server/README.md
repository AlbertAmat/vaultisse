# Vaultisse — Server

Express + TypeScript REST API for Vaultisse, backed by PostgreSQL. See the
[repository root README](../README.md) for the full project overview,
architecture, and setup instructions covering both the client and the server.

## Quick start

```bash
npm install
cp .env.example .env   # then fill in your local values
npm run dev             # starts the API with tsx watch
```

See [Configure the server](../README.md#3-configure-the-server) in the root
README for what each environment variable does, and
[Set up the database](../README.md#2-set-up-the-database) for loading the schema.

## Scripts

- `npm run dev` — start the API in watch mode (`NODE_ENV=development`)
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run the compiled server (`dist/index.js`) — used in production
- `npm run lint` — run `tslint --fix`

## Structure

See [Server (backend)](../README.md#server-backend) in the root README for a
breakdown of `src/routes`, `src/middlewares`, `src/types`, `src/utils`, and
`src/assets`.

## Authentication

Sessions are JWTs stored in an HTTP-only `token` cookie, verified on every
protected request by `requireAuth`/`requireAuthPage`
(`src/middlewares/AuthMiddleware.ts`) - not just the JWT signature, but also a
per-user `token_version` counter and a per-login `user_sessions` row, so a
session can actually be revoked (one device or all of them) rather than just
expiring on its own. See [docs/AUTHENTICATION.md](../docs/AUTHENTICATION.md) for the
full model, or [SECURITY.md](../SECURITY.md) for reporting auth-related
issues. Never set `ALLOW_DEV_AUTH=true` outside local development — it
bypasses login entirely.
