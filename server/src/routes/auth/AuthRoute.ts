/**
 * =============================================================================
 * AuthRoute
 * =============================================================================
 * Mounted directly at `/` (not under `/api/rest`, see AppService.__loadRoutes).
 * Owns the whole unauthenticated surface: serving the login/register static
 * pages, the login/register/logout POST handlers, optional OIDC start/
 * callback, session-cookie issuance, and (once logged in) serving the
 * compiled SPA under `/app`. See AuthController/AuthService/AuthRepository
 * (+ OidcRepository/OidcUserService/OidcUserRepository for SSO) for the
 * actual request handling, business rules, and SQL/IdP calls respectively.
 *
 * Session model: on successful login/register a signed JWT is stored in an
 * httpOnly `token` cookie (see `AppService.createSessionToken`); every
 * subsequent request is authenticated by `requireAuth`
 * (server/src/middlewares/AuthMiddleware.ts) reading that cookie.
 *
 * Accounts with two-factor auth enabled (`users.totp_enabled`, managed via
 * `/api/rest/user/2fa/*` in UserRoute.ts) don't get a `token` cookie from
 * POST /login directly - they get a short-lived `pending_2fa_token` cookie
 * instead, exchanged for the real session by POST /login/2fa.
 */
import express from "express";
import path from "path";
import rateLimit from "express-rate-limit";
import {requireAuth, requireAuthPage} from "../../middlewares/AuthMiddleware";
import * as AuthController from "../../controllers/AuthController";

const router = express.Router();

// Stricter than the app-wide limiter in AppService: login/register are the
// endpoints most worth protecting from brute-force/credential-stuffing.
const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // only allow 5 requests per IP per window
    message: "Too many attempts, please try again after 15 minutes.",
});

// Separate from authLimiter so a legitimate user isn't left with too few
// attempts to type their code after already spending a request on the
// password step - but just as strict, since a 6-digit TOTP code is a much
// smaller space to brute-force than a password.
const twoFaLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5,
    message: "Too many attempts, please try again after 15 minutes.",
});

/**
 * GET /app/assets/*  (static)
 * -----------------------------
 * Serves the SPA's built JS/CSS assets. Auth-gated so the app bundle itself
 * isn't served to unauthenticated clients.
 */
router.use("/app/assets", requireAuth, express.static(path.join(AuthController.clientDistPath, "assets"), {
    setHeaders: (res, path) => {
        if (path.endsWith(".css")) {
            res.set('Content-Type', 'text/css');
        }
    }
}));

/**
 * GET /app, GET /app/*
 * ----------------------
 * Serves the SPA's `index.html` entry point (production only - in dev the
 * Vite dev server handles this), including as a catch-all so client-side
 * (Vue Router) routes like `/app/book/12` still resolve to the SPA shell on
 * a hard refresh. Auth: required (redirects to `/login` on failure - see
 * `requireAuthPage` - rather than the JSON 401 `requireAuth` uses
 * elsewhere, since there's no SPA on screen yet to show that in).
 */
router.get('/app', requireAuthPage, AuthController.serveApp);
router.get('/app/*', requireAuthPage, AuthController.serveApp);

/**
 * GET /
 * ------
 * Redirects to `/app` if a session cookie is present, otherwise to `/login`.
 * Unauthenticated - it only checks for the cookie's presence, not validity
 * (an invalid/expired token still lands the user on `/app`, where
 * `requireAuth` then bounces them to `/login`).
 */
router.get("/", AuthController.redirectRoot);

/**
 * GET /login
 * -----------
 * Serves the static login page and clears any existing session cookie.
 * Unauthenticated.
 */
router.get("/login", AuthController.showLogin);

/**
 * POST /login
 * ------------
 * Authenticate with username/email + password, issue a session cookie.
 *
 * Rate limited: 5 requests / 5 minutes / IP (see `authLimiter`).
 * Unauthenticated. Body: { "username": "jdoe", "password": "S3cret!123" }
 * (`username` may be either the user's code or email).
 *
 * If the account has two-factor auth enabled, this only verifies the
 * password: it sets a short-lived `pending_2fa_token` cookie and responds
 * with `twoFactorRequired: true` instead of a session - see POST /login/2fa
 * for the second step that actually issues the `token` session cookie.
 *
 * Example response (200, no 2FA):
 *  { "success": true, "message": "Login successful", "redirectUrl": "/app" }
 * Example response (200, 2FA enabled):
 *  { "success": true, "twoFactorRequired": true, "message": "Enter your verification code" }
 * Sets an httpOnly `token` cookie (JWT, expires per `SESSION_TIME` env var)
 * when no 2FA step follows.
 *
 * Responses: 400 missing fields | 401 invalid credentials | 500 server error.
 */
router.post("/login", authLimiter, AuthController.login);

/**
 * POST /login/2fa
 * -----------------
 * Second step of login for accounts with two-factor auth enabled: verifies
 * a TOTP code (or a one-time backup code) against the `pending_2fa_token`
 * cookie set by POST /login, then issues the real session cookie.
 *
 * Rate limited: 5 requests / 5 minutes / IP (see `twoFaLimiter`).
 * Unauthenticated (relies on the short-lived pending cookie instead).
 * Body: { "code": "123456" } (either the 6-digit authenticator code, or an
 * "XXXXXXXX-XXXXXXXX" backup code).
 *
 * Example response (200):
 *  { "success": true, "message": "Login successful", "redirectUrl": "/app" }
 * Sets an httpOnly `token` cookie and clears `pending_2fa_token`.
 *
 * Responses: 400 missing code | 401 no/expired pending login or invalid code |
 *            500 server error.
 */
router.post("/login/2fa", twoFaLimiter, AuthController.loginTwoFactor);

/**
 * GET /auth/oidc/status
 * ----------------------
 * Whether SSO is offered on the login page. Unauthenticated.
 * Demo mode always reports disabled (JIT would create accounts on the
 * shared demo catalog).
 *
 * Example response (200): { "enabled": true, "label": "Sign in with SSO" }
 */
router.get("/auth/oidc/status", AuthController.oidcStatus);

/**
 * GET /auth/oidc/start
 * ---------------------
 * Begin the authorization-code + PKCE flow: set a short-lived SameSite=lax
 * `oidc_pending` cookie and redirect to the IdP with `prompt=login` so an
 * existing Authentik session is not reused silently. Rate limited like login.
 * 404 when SSO is not enabled.
 */
router.get("/auth/oidc/start", authLimiter, AuthController.oidcStart);

/**
 * GET /auth/oidc/callback
 * ------------------------
 * IdP return: exchange the code, find/link/JIT the user, issue the same
 * `token` session cookie as password login, redirect to /app. Failures
 * bounce to /login?error=sso (generic - don't leak IdP details).
 */
router.get("/auth/oidc/callback", authLimiter, AuthController.oidcCallback);

/**
 * GET /register
 * --------------
 * Serves the static registration page, or redirects to `/app` if a session
 * cookie is already present. Unauthenticated.
 */
router.get("/register", AuthController.showRegister);

/**
 * POST /register
 * ----------------
 * Create a new user account.
 *
 * Rate limited: 5 requests / 5 minutes / IP (see `authLimiter`).
 * Unauthenticated.
 * Body:
 *  {
 *    "userName": "jdoe",             // unique login code
 *    "email": "jane@example.com",    // unique, validated with a basic regex
 *    "name": "Jane Doe",
 *    "password": "S3cret!123"        // min 8 chars, needs an uppercase letter,
 *                                    // a digit and a special character
 *  }
 *
 * `REGISTRATION_REQUIRES_APPROVAL=true` (.env, default false) creates the
 * account with `disabled = TRUE` instead of the normal `FALSE`: it exists in
 * the DB but can't log in (see the `disabled = FALSE` clause everywhere
 * AuthRoute/AuthMiddleware look up a user) until an admin flips that column
 * by hand - there's no in-app admin role/UI for this, see AUTHENTICATION.md.
 *
 * Example response (201):
 *  { "success": true, "message": "Register successful", "redirectUrl": "/login" }
 *
 * Responses: 400 missing/invalid fields, weak password, or a duplicate
 *            email/username (deliberately generic - see CWE-203 note in
 *            AuthService.register) | 500 server error.
 */
router.post("/register", authLimiter, AuthController.register);

/**
 * GET /logout
 * ------------
 * Clear the session cookie and redirect to `/login`. Also best-effort
 * revokes the matching `user_sessions` row (see AuthMiddleware.ts) so it
 * drops off "Active sessions" in Settings and, unlike a plain expiry, can't
 * be replayed even if the cleared cookie somehow survived client-side -
 * this always succeeds (redirects to `/login`) even if the cookie is
 * missing/invalid/already expired.
 */
router.get("/logout", AuthController.logout);

export default router;
