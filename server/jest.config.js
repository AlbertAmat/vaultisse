/**
 * Integration tests share one Postgres test database (see
 * test/setup/globalSetup.js), so `maxWorkers: 1` runs test FILES serially -
 * safe parallelism across shared DB state would need per-file isolation this
 * suite doesn't have. Each file's own tests still run in Jest's normal
 * (fast) in-process order.
 */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    rootDir: ".",
    testMatch: ["<rootDir>/test/**/*.test.ts"],
    // The *Real.test.ts files call live external services (DNB, BNE, SBN), so
    // they're opt-in (`npm run test:real`) - otherwise CI fails whenever one of
    // those services is slow, down, or unreachable from the runner.
    testPathIgnorePatterns: process.env.RUN_REAL_TESTS ? ["/node_modules/"] : ["/node_modules/", "Real\\.test\\.ts$"],
    setupFiles: ["<rootDir>/test/setup/testEnv.js"],
    globalSetup: "<rootDir>/test/setup/globalSetup.js",
    maxWorkers: 1,
    testTimeout: 20000,
    verbose: true,
    // otplib (via TwoFactorAuth.ts, pulled in transitively by every route
    // module through Routes.ts) depends on @scure/base and @noble/hashes,
    // which ship ESM-only with no CJS entry point - Jest's default CJS
    // require() can't load them. Un-ignoring them here lets ts-jest also
    // transform those two packages (allowJs below) down to CommonJS, the
    // same as it does for our own source.
    transformIgnorePatterns: ["/node_modules/(?!(@scure|@noble)/)"],
    transform: {
        "^.+\\.[tj]sx?$": ["ts-jest", {tsconfig: "tsconfig.test.json"}],
    },
};
