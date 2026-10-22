# Vaultisse — Client

Vue 3 + Vuetify 3 single-page application for Vaultisse, built with Vite and
TypeScript. See the [repository root README](../README.md) for the full project
overview, architecture, and setup instructions covering both the client and the
server.

## Quick start

```bash
npm install          # from the repo root: the client is an npm workspace
npm run dev          # starts Vite; proxies /api/rest to the server (see vite.config.ts)
```

The server must be running separately for API calls to succeed — see the
[server README](../server/README.md) or the
[root README's getting-started guide](../README.md#getting-started).

## Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — type-check and build for production into `dist/`
- `npm run preview` — preview the production build locally
- `npm run type-check` — run `vue-tsc` without emitting output

## Structure

See [Client (frontend)](../README.md#client-frontend) in the root README for a
breakdown of `src/views`, `src/controller`, `src/service`, `src/model`,
`src/router`, `src/components`, and `src/plugins`.

## Configuration

The client does not read any `VITE_*` environment variables at build/runtime —
its only external dependency is the REST API, reached at `/api/rest` relative to
wherever the app is served (proxied to the backend in dev, same-origin in
production). All configurable values (ports, secrets, external API keys) live in
the [server's `.env`](../README.md#3-configure-the-server).
