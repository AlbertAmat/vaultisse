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

## Shared with the server

Enums that are values of a DB column or an API parameter are defined **once**, here,
and used by both sides: `BookStockStatusEnum`, `ReadingStatusEnum`, `SearchFilter`,
`SortType`, `VaultRoleSource`, `VaultUserStatus`, `ActivityAction`. The server must not
define its own copy.

The server is built and installed standalone (CommonJS, its own lockfile, `build.sh`
and its own Docker stage), so it is not part of the npm workspace and can't depend on
the package. Instead `server/scripts/sync-shared-types.js` copies `packages/types/src`
into `server/src/shared/types/` (generated, gitignored) before `build`, `dev`, `lint`
and `test` (the `pre*` npm scripts), and the server imports from there:

```ts
import {ReadingStatusEnum} from "../shared/types/book/IReadingStatus";
```

Edit the files in `packages/types/src`, never the copy. The server's own `src/types/`
keeps what is server-side only (DB rows, route inputs, `VaultRoleCode`).

Not unified: the server's interfaces for response bodies (e.g. `BookStockDetail`) and
the client's `I*` types describe the same JSON under different names and are still
written twice.
