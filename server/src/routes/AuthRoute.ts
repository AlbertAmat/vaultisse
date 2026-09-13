/**
 * =============================================================================
 * AuthRoute
 * =============================================================================
 * Mounted directly at `/` (not under `/api/rest`, see AppService.__loadRoutes).
 * Owns the whole unauthenticated surface: serving the login/register static
 * pages, the login/register/logout POST handlers, session-cookie issuance,
 * and (once logged in) serving the compiled SPA under `/app`.
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
import express, {Request, Response} from "express";
import {appService} from "../AppService";
import path from "path";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import {requireAuth, requireAuthPage} from "../middlewares/AuthMiddleware";
import {verifyTotpCode, normalizeBackupCode} from "../utils/TwoFactorAuth";
import {createUserSession} from "../utils/UserSessions";
import {recordActivity, ActivityAction} from "../utils/ActivityLog";

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
 * Checks `code` against `userId`'s unused backup codes; consumes (marks
 * used) and returns true on a match. Codes are hashed with the same
 * bcrypt helper as passwords (see `appService.hashPassword`), so this is a
 * linear scan + compare rather than a direct lookup - fine at the "~10
 * codes per user" scale these are generated at.
 */
async function consumeBackupCode(userId: number, code: string): Promise<boolean> {
    const pool = appService.getDatabasePool();
    const result = await pool.query(
        "SELECT id, code_hash FROM user_backup_codes WHERE user_id = $1 AND used_date IS NULL",
        [userId]
    );

    for (const row of result.rows) {
        if (await appService.comparePassword(code, row.code_hash)) {
            await pool.query("UPDATE user_backup_codes SET used_date = CURRENT_TIMESTAMP WHERE id = $1", [row.id]);
            return true;
        }
    }

    return false;
}

// Compiled Vue app: alongside the server in production (Docker image),
// under client/dist during local development.
const clientDistPath = process.env.NODE_ENV === "production" ?  path.join(__dirname, "../../../client") : path.join(__dirname, '../../../client/dist')

/**
 * GET /app/assets/*  (static)
 * -----------------------------
 * Serves the SPA's built JS/CSS assets. Auth-gated so the app bundle itself
 * isn't served to unauthenticated clients.
 */
router.use("/app/assets", requireAuth, express.static(path.join(clientDistPath, "assets"), {
    setHeaders: (res, path) => {
        if (path.endsWith(".css")) {
            res.set('Content-Type', 'text/css');
        }
    }
}));

/**
 * GET /app
 * ---------
 * Serves the SPA's `index.html` entry point (production only - in dev the
 * Vite dev server handles this). Auth: required (redirects to `/login` on
 * failure - see `requireAuthPage` - rather than the JSON 401 `requireAuth`
 * uses elsewhere, since there's no SPA on screen yet to show that in).
 */
router.get('/app', requireAuthPage, async (req: Request, res: Response) => {
    const appPath = path.join(clientDistPath, "index.html");

    appService.getLogger().debug(`serving /app index: ${appPath}`);
    res.sendFile(appPath);
})

/**
 * GET /app/*
 * -----------
 * Catch-all so client-side (Vue Router) routes like `/app/book/12` still
 * resolve to the SPA shell on a hard refresh. Auth: required (see the
 * `requireAuthPage` note on `GET /app` just above).
 */
router.get('/app/*', requireAuthPage, async (req: Request, res: Response) => {
    const appPath = path.join(clientDistPath, "index.html");

    appService.getLogger().debug(`serving /app/* index: ${appPath}`);
    res.sendFile(appPath);
})

/**
 * GET /
 * ------
 * Redirects to `/app` if a session cookie is present, otherwise to `/login`.
 * Unauthenticated - it only checks for the cookie's presence, not validity
 * (an invalid/expired token still lands the user on `/app`, where
 * `requireAuth` then bounces them to `/login`).
 */
router.get("/", (req: Request, res: Response) => {
    // Check if the user is authenticated by looking at the session

    // @ts-ignore
    if (req.cookies.token) {
        appService.getLogger().debug("User already logged in, redirecting to /app...");
        return res.redirect("/app"); // Redirect to /app if user is logged in
    } else {
        appService.getLogger().debug("User not logged in, redirecting to /login...");
        return res.redirect("/login"); // Redirect to login page if user is not logged in
    }
});

/**
 * GET /login
 * -----------
 * Serves the static login page and clears any existing session cookie.
 * Unauthenticated.
 */
// @ts-ignore
router.get("/login", (req: Request, res: Response) => {
    // If user goes to login page, clear the current token.
    // we can improve it, by checking if the token is valid, etc ad redirect to app
    // at the moment, we will clear the token
    res.clearCookie("token");
    res.clearCookie("pending_2fa_token");
    res.sendFile(path.join(__dirname, "..", "assets", "login.html"));
});

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
// @ts-ignore
router.post("/login", authLimiter,  async (req: Request, res: Response) => {
    appService.getLogger().debug("Handle login authentication");
    const username = typeof req.body.username === "string" ? req.body.username.trim() : req.body.username;
    const {password} = req.body;
    if (!username || !password) {
        return res.status(400).json({message: "Missing username or password"});
    }

    try {
        const pool = appService.getDatabasePool();
        const userQuery = "SELECT id, code, password, token_version, totp_enabled FROM users WHERE (code = $1 OR email = $2) AND disabled = FALSE";
        const userResult = await pool.query(userQuery, [username, username]);

        if (userResult.rows.length === 0) {
            appService.getLogger().debug("No user found for:" + username);
            await recordActivity(pool, null, ActivityAction.LOGIN_FAILED, {metadata: {attemptedUsername: username, ip: req.ip}});
            return res.status(401).json({message: "Invalid username or password."});
        }

        const user = userResult.rows[0];

        const comparePassword = await appService.comparePassword(password, user.password);
        if (!comparePassword) {
            appService.getLogger().debug("invalid password for user:" + username);
            await recordActivity(pool, user.id, ActivityAction.LOGIN_FAILED, {metadata: {ip: req.ip}});
            return res.status(401).json({message: "Invalid username or password."});
        }

        if (user.totp_enabled) {
            appService.getLogger().debug("Password OK, awaiting 2FA code for user:" + username);

            const pendingToken = appService.createPending2faToken(user.id);
            res.cookie("pending_2fa_token", pendingToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                maxAge: 5 * 60 * 1000
            });

            return res.json({success: true, twoFactorRequired: true, message: "Enter your verification code"});
        }

        appService.getLogger().debug("Updating last login date for user:" + username);
        // Update the last login date
        const updateLoginQuery = `
            UPDATE users
            SET last_login_date = CURRENT_TIMESTAMP
            WHERE id = $1
        `;
        await pool.query(updateLoginQuery, [user.id]);

        appService.getLogger().debug("Setting session and cookie for user:" + username);

        const {sessionKey} = await createUserSession(pool, user.id, req.get("user-agent"), req.ip);
        await recordActivity(pool, user.id, ActivityAction.LOGIN, {metadata: {ip: req.ip}});

        const userToken = appService.createSessionToken(user.id, user.token_version, sessionKey);

        // Send JWT in cookie
        res.cookie("token", userToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: appService.getSessionTime()
        });

        appService.getLogger().debug("Redirecting to /app for user:" + username);

        res.json({success: true, message: "Login successful", redirectUrl: "/app"});
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({message: "Internal server error"});
    }
});

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
// @ts-ignore
router.post("/login/2fa", twoFaLimiter, async (req: Request, res: Response) => {
    const {code} = req.body;
    // @ts-ignore
    const pendingToken = req.cookies.pending_2fa_token;

    if (!code) {
        return res.status(400).json({message: "Missing verification code"});
    }

    const userId = appService.verifyPending2faToken(pendingToken);
    if (userId === null) {
        res.clearCookie("pending_2fa_token");
        return res.status(401).json({message: "Your login has expired. Please log in again."});
    }

    try {
        const pool = appService.getDatabasePool();
        const userResult = await pool.query(
            "SELECT id, token_version, totp_secret FROM users WHERE id = $1 AND disabled = FALSE AND totp_enabled = TRUE",
            [userId]
        );

        if (userResult.rows.length === 0) {
            res.clearCookie("pending_2fa_token");
            return res.status(401).json({message: "Your login has expired. Please log in again."});
        }

        const user = userResult.rows[0];
        const rawCode = String(code).trim();

        let verified = await verifyTotpCode(user.totp_secret, rawCode);
        if (!verified) {
            verified = await consumeBackupCode(user.id, normalizeBackupCode(rawCode));
        }

        if (!verified) {
            await recordActivity(pool, user.id, ActivityAction.LOGIN_FAILED, {metadata: {stage: "2fa", ip: req.ip}});
            return res.status(401).json({message: "Invalid verification code."});
        }

        res.clearCookie("pending_2fa_token");

        await pool.query(`UPDATE users SET last_login_date = CURRENT_TIMESTAMP WHERE id = $1`, [user.id]);

        const {sessionKey} = await createUserSession(pool, user.id, req.get("user-agent"), req.ip);
        await recordActivity(pool, user.id, ActivityAction.LOGIN, {metadata: {ip: req.ip}});

        const userToken = appService.createSessionToken(user.id, user.token_version, sessionKey);
        res.cookie("token", userToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: appService.getSessionTime()
        });

        res.json({success: true, message: "Login successful", redirectUrl: "/app"});
    } catch (error) {
        console.error("2FA verification error:", error);
        return res.status(500).json({message: "Internal server error"});
    }
});

/**
 * GET /register
 * --------------
 * Serves the static registration page, or redirects to `/app` if a session
 * cookie is already present. Unauthenticated.
 */
router.get("/register", (req: Request, res: Response) => {
    // @ts-ignore
    if (req.cookies.token) {
        return res.redirect("/app");
    }
    res.sendFile(path.join(__dirname, "..", "assets", "register.html"));
});

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
 *            email/username (deliberately generic - see CWE-203 note below) |
 *            500 server error.
 */
router.post("/register", authLimiter, async (req: Request, res: Response) => {
    const { password } = req.body;
    const userName = typeof req.body.userName === "string" ? req.body.userName.trim() : req.body.userName;
    const email = typeof req.body.email === "string" ? req.body.email.trim() : req.body.email;
    const name = typeof req.body.name === "string" ? req.body.name.trim() : req.body.name;

    // Basic input validation
    if (!email || !userName || !name || !password) {
        return res.status(400).json({ message: "Missing required fields." });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email format." });
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+[\]{};':"\\|,.<>/?]).{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({
            message: "Password must be at least 8 characters long and include a number, an uppercase letter, and a special symbol."
        });
    }

    try {
        const pool = appService.getDatabasePool();

        // Hash the password securely
        const hashedPassword = await appService.hashPassword(password);

        const requiresApproval = process.env.REGISTRATION_REQUIRES_APPROVAL === "true";

        // Use INSERT with unique constraints to avoid race conditions
        const insertQuery = `
            INSERT INTO users (name, code, email, password, disabled)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `;

        await pool.query(insertQuery, [name, userName, email, hashedPassword, requiresApproval]);

        return res.status(201).json({
            success: true,
            message: requiresApproval
                ? "Registration successful. An administrator needs to review and approve your account before you can log in."
                : "Registration successful. You can now log in.",
            requiresApproval,
            redirectUrl: "/login",
        });

    } catch (error: any) {
        // Handle unique constraint violation with a generic message - confirming
        // that a specific email/username is already registered would let an
        // attacker enumerate existing accounts (CWE-203).
        if (error.code === "23505") { // PostgreSQL unique violation
            return res.status(400).json({ message: "Unable to register with the provided information." });
        }

        console.error("Register error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});


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
router.get("/logout", async (req: Request, res: Response) => {
    appService.getLogger().debug("Logout user");

    // @ts-ignore
    const token = req.cookies.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, appService.getJwtSecret(), {
                algorithms: ["HS256"],
                audience: "vaultisse",
                issuer: "vaultisse.com"
            }) as { user_id: number; sid: string };

            const pool = appService.getDatabasePool();
            const result = await pool.query(
                `UPDATE user_sessions SET revoked_date = NOW()
                 WHERE session_key = $1 AND user_id = $2 AND revoked_date IS NULL
                 RETURNING id`,
                [decoded.sid, decoded.user_id]
            );

            if ((result.rowCount ?? 0) > 0) {
                await recordActivity(pool, decoded.user_id, ActivityAction.LOGOUT, {metadata: {ip: req.ip}});
            }
        } catch (err) {
            // Already invalid/expired - nothing to revoke, just clear the cookie below.
        }
    }

    res.clearCookie("token");
    return res.redirect("/login"); // Redirect to login;
});

export default router;
