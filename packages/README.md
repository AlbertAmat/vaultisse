# Shared packages

npm workspace packages (declared in the root `package.json` together with
`client/`) that hold everything a *consumer of the REST API* needs, so the web
client, a browser extension, or any other front end can share it instead of
copying it.

| Package | Contents |
|---|---|
| [`@vaultisse/types`](types) | The wire types: request/response interfaces (`IBook`, `IPolicyResponse`, ...) and the enums that travel over the API (`BookStockStatusEnum`, `ReadingStatusEnum`, ...). Pure TypeScript, no runtime dependencies. |
| [`@vaultisse/api-client`](api-client) | `createApiClient()`: one service class per `/api/rest/<resource>` (`api.books`, `api.loans`, ...) on a shared axios instance. No UI or framework code. |

Both are **source-only**: there is no build step, the consuming bundler (Vite,
esbuild, webpack, ...) compiles the TypeScript directly. Consumers need
`moduleResolution: "bundler"` (or `node16`/`nodenext`) in their tsconfig so the
`exports` maps resolve.

## Using them

```ts
import {createApiClient} from "@vaultisse/api-client";
import IBook from "@vaultisse/types/book/IBook";

const api = createApiClient({
    // omit for same-origin (the web client); a browser extension passes the server's origin
    baseURL: "https://books.example.com",
    // how this host reacts to failures; the package itself has no UI
    onError: error => console.error(error.response?.status),
    onSessionExpired: () => showLoginScreen(),
});

const book: IBook = await api.books.getBook(12);
```

Requests marked `suppressErrorDialog: true` (e.g. `api.books.findCover`) skip
`onError` - the caller renders its own error UI. App-level errors in
`AppError` (currently 404 for a missing book) are never reported to `onError`,
so the calling code handles them.

The web client wires this up once in `client/src/plugins/api.ts`.

## Adding an endpoint

1. Add/adjust the types in `packages/types/src/` (the shapes must match what the
   route in `server/src/routes/` returns).
2. Add the method to the matching service in `packages/api-client/src/`.
3. Call it from the client as `api.<resource>.<method>()` (`client/src/plugins/api.ts`).

## What is *not* shared (yet)

`server/` still has its own `src/types/`. Those are server-side shapes (DB rows,
route inputs), not the wire types, and the server is built and installed
standalone (CommonJS, its own lockfile, its own Docker stage), so it is not
part of the workspace. Only the enums are literal duplicates
(`BookStockStatusEnum`, `ReadingStatusEnum`); keep them in sync by hand.
