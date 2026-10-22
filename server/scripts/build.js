/**
 * Bundles the server into dist/index.js with esbuild (the `tsc` step only
 * type-checks - see `npm run typecheck`).
 *
 * Bundling is what lets the server import the shared wire types/enums straight
 * from ../packages/types (via the `@vaultisse/types/*` path alias in tsconfig.json)
 * without copying them in or publishing a package: they are compiled into the
 * bundle along with the server's own code. Everything listed in `dependencies`
 * stays external and is installed with `npm ci --omit=dev` (bcrypt is a native addon).
 */
const esbuild = require("esbuild");
const path = require("path");
const pkg = require("../package.json");

esbuild.buildSync({
    entryPoints: [path.resolve(__dirname, "../src/index.ts")],
    outfile: path.resolve(__dirname, "../dist/index.js"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    sourcemap: true,
    tsconfig: path.resolve(__dirname, "../tsconfig.json"),
    external: Object.keys(pkg.dependencies),
    logLevel: "info",
});
