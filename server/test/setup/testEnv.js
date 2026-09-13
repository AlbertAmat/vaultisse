/**
 * Jest `setupFiles` entry - runs once per test file, before that file's
 * modules (and so before `AppService`'s constructor, which reads these same
 * variables) are ever required. Points the app at the dedicated test
 * database and forces every behavior flag to a deterministic value,
 * regardless of what the developer's own `server/.env` (or CI's real
 * environment) happens to have set for local development.
 *
 * TRUST_PROXY=true is deliberate here (unlike real deployments, where it's
 * only safe behind an actual reverse proxy): it lets `test/helpers/auth.ts`
 * give each login/register pair its own `X-Forwarded-For` IP, so many tests
 * can each get a fresh bucket against the shared authLimiter (5 req/5min per
 * IP) instead of tripping it after a handful of auth-related tests.
 */
const path = require("path");
const {getTestDbConfig} = require("./testDbConfig");

const dbConfig = getTestDbConfig(); // also loads server/.env for anything not already set.

process.env.DB_HOST = String(dbConfig.host);
process.env.DB_PORT = String(dbConfig.port);
process.env.DB_USER = String(dbConfig.user);
process.env.DB_PASSWORD = String(dbConfig.password);
process.env.DB_NAME = dbConfig.database;

process.env.ALLOW_DEV_AUTH = "false";
process.env.DEMO_MODE = "false";
process.env.REGISTRATION_REQUIRES_APPROVAL = "false";
process.env.TRUST_PROXY = "true";
process.env.API_PORT = "0"; // OS-assigned free port - many test files run their own server.
process.env.LOGGER_PATH = path.join(__dirname, "..", ".tmp", "logs");
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-do-not-use-in-production";
process.env.SESSION_TIME = process.env.SESSION_TIME || String(60 * 60 * 1000);
process.env.FRONT_END_URL = process.env.FRONT_END_URL || "http://localhost:5173";
// Unconditional (not `||`-defaulted): a placeholder value some developers
// leave in their own server/.env (e.g. "npm") would otherwise leak in here
// and silently flip which branch (Google Books vs. the Open Library
// fallback) BooksRoute.ts's ISBN lookup takes between machines/CI - tests
// mock both branches explicitly (see BooksRoute.test.ts) and must not
// depend on which one actually runs.
process.env.GOOGLE_BOOKS_API_KEY = "";
process.env.MAX_IMPORT_FILE_SIZE_MB = process.env.MAX_IMPORT_FILE_SIZE_MB || "10";
process.env.MAX_EBOOK_FILE_SIZE_MB = process.env.MAX_EBOOK_FILE_SIZE_MB || "10";
process.env.DEBUG_LOGGING = "false";
// SSO off unless a specific test file sets these itself (AppService reads
// them once at construct time, so the default suite stays password-only).
process.env.OIDC_ISSUER = "";
process.env.OIDC_CLIENT_ID = "";
process.env.OIDC_CLIENT_SECRET = "";
process.env.OIDC_REDIRECT_URI = "";
