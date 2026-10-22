/**
 * Locations of the files the server reads from disk at runtime. They differ
 * between the two layouts the code runs in:
 *  - development / tests: TypeScript sources, this file is `server/src/utils/Paths.ts`
 *    and the repo root is three levels up (compiled client in `client/dist`).
 *  - production (Docker image): everything is bundled into one `index.js`
 *    (see scripts/build.js) and `__dirname` is its folder (`/app`), with
 *    `assets/`, `client/` and `db/upgrade/` next to it - see the Dockerfile.
 */
import * as path from "path";

const production = process.env.NODE_ENV === "production";

/** `login.html`, `register.html` and the `app/` static folder. */
export const ASSETS_DIR = production ? path.join(__dirname, "assets") : path.join(__dirname, "..", "assets");

/** Compiled Vue app: alongside the server in production, under `client/dist` during local development. */
export const CLIENT_DIST_DIR = production ? path.join(__dirname, "client") : path.join(__dirname, "..", "..", "..", "client", "dist");

/** Dated `.sql` upgrade files applied on startup (`assets/db/upgrade` at the repo root; `db/upgrade` in the image). */
export const UPGRADE_SQL_DIR = production
    ? path.join(__dirname, "db", "upgrade")
    : path.join(__dirname, "..", "..", "..", "assets", "db", "upgrade");
