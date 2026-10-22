/**
 * Copies the shared wire types (packages/types/src, the single source of
 * truth also used by the web client) into src/shared/types so the server's
 * `tsc` (rootDir: ./src) compiles them into dist like any other server file.
 * The server is built and installed standalone (build.sh, Dockerfile), so it
 * can't depend on the npm workspace; src/shared/ is generated and gitignored.
 *
 * Runs automatically before build / dev / lint / test (see package.json).
 */
const fs = require("fs");
const path = require("path");

const from = path.resolve(__dirname, "../../packages/types/src");
const to = path.resolve(__dirname, "../src/shared/types");

if (!fs.existsSync(from)) {
    console.error(`sync-shared-types: ${from} not found (the shared types package must be present when building the server)`);
    process.exit(1);
}

fs.rmSync(to, {recursive: true, force: true});
fs.mkdirSync(path.dirname(to), {recursive: true});
fs.cpSync(from, to, {recursive: true});
