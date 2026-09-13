/**
 * Express middleware that gates every authenticated route.
 *
 * Flow: read the `token` httpOnly cookie -> verify its JWT signature/claims
 * -> look up the user and compare `token_version` (a DB counter bumped on
 * password change, so old tokens can be revoked even though JWTs are
 * otherwise stateless) -> look up the specific `user_sessions` row the
 * token's `sid` claim identifies and reject if it's been individually
 * revoked (see "Log out this device" in Settings) -> if valid and about to
 * expire, silently reissue a fresh cookie -> call `next()`.
 *
 * In development (`ALLOW_DEV_AUTH=true`), it skips real auth entirely and
 * fakes a session for user id 1 - never enable this in production. The fake
 * token's `sid` is a sentinel that never matches a real `user_sessions` row
 * (there was never a real login to create one), so the per-session check
 * below is skipped for it too.
 *
 * Two variants share this same resolution logic (see `resolveSession`),
 * differing only in how they fail:
 *  - `requireAuth` - for `/api/rest/*` JSON endpoints. Usage:
 *    `router.get('/foo', requireAuth, handler)`. Failure responses: 401
 *    `{message: "Unauthorized", sessionExpired: true}` (missing/invalid/
 *    expired/revoked token) - `sessionExpired` is what the client's axios
 *    interceptor (axiosInstance.ts) keys off of to redirect to `/login`,
 *    as opposed to a 401 from actual in-page logic (a wrong current
 *    password, say) that has no reason to force a redirect.
 *  - `requireAuthPage` - for the server-rendered `/app` and `/app/*` HTML
 *    routes (AuthRoute.ts). Failure: redirects to `/login` either way,
 *    since there's no SPA yet on screen to show a JSON error in.
 */
import {Request, Response, NextFunction} from "express";
import jwt from "jsonwebtoken";
import {appService} from "../AppService";
import {setSessionCookie} from "../utils/SessionCookie";

/** Sentinel `sid` for the fake ALLOW_DEV_AUTH token - never matches a real `user_sessions` row. Exported so handlers reissuing a token (e.g. password change) can fall back to it when `req.sessionKey` is unset. */
export const DEV_SESSION_KEY = "dev";

type SessionResolution = "ok" | "no-token" | "unauthorized";

/**
 * Does the actual work: resolves (and, on success, attaches to `req`/
 * refreshes the cookie on) the caller's session, without deciding how a
 * failure should be reported - that's each exported middleware's job.
 */
async function resolveSession(req: Request, res: Response): Promise<SessionResolution> {
    const pool = appService.getDatabasePool();

    // only development
    if (appService.allowDevAuth()) {
        appService.getLogger().info("Serving DEVELOPMENT token")

        // Look up the real current token_version for the fake user so the
        // check below (identical for dev and real tokens) accepts it.
        const devUser = await pool.query(
            "SELECT token_version FROM users WHERE id = 1 AND disabled = FALSE"
        );
        const devTokenVersion = devUser.rows[0]?.token_version ?? 0;

        // Fake decoded token for dev
        req.cookies.token = appService.createSessionToken(1, devTokenVersion, DEV_SESSION_KEY); // fake user ID
    }

    const token = req.cookies.token;
    if (!token) {
        return "no-token";
    }

    let decoded;
    try {
        decoded = jwt.verify(token, appService.getJwtSecret(), {
            algorithms: ["HS256"],
            audience: "vaultisse",
            issuer: "vaultisse.com"
        }) as { user_id: number; token_version: number; sid: string; exp: number };
    } catch (err: any) {
        appService.getLogger().error(err.toString());
        return "unauthorized";
    }

    const result = await pool.query({
        name: "user-prep-stmt",
        text: "SELECT id, token_version FROM users WHERE id = $1 AND disabled = FALSE",
        values: [decoded.user_id]
    });

    if (result.rowCount == 0) {
        return "unauthorized";
    }

    const currentTokenVersion = result.rows[0].token_version;

    // Tokens issued before a password change (or any other event that bumps
    // token_version) no longer match - reject them even though the JWT
    // signature itself is still valid. This is what makes logout-elsewhere /
    // password-change session revocation possible with stateless JWTs.
    if (decoded.token_version !== currentTokenVersion) {
        return "unauthorized";
    }

    if (decoded.sid !== DEV_SESSION_KEY) {
        const sessionResult = await pool.query(
            "SELECT id FROM user_sessions WHERE session_key = $1 AND user_id = $2 AND revoked_date IS NULL",
            [decoded.sid, decoded.user_id]
        );

        if (sessionResult.rowCount === 0) {
            return "unauthorized";
        }

        req.sessionId = sessionResult.rows[0].id;
        req.sessionKey = decoded.sid;

        // Best-effort and throttled (only writes once the row is more than
        // a minute stale) - keeps "Active sessions" reasonably fresh
        // without a DB write on every single authenticated request.
        pool.query(
            "UPDATE user_sessions SET last_seen_date = NOW() WHERE id = $1 AND last_seen_date < NOW() - INTERVAL '1 minute'",
            [req.sessionId]
        ).catch((err) => appService.getLogger().error("Error updating session last_seen_date: " + err));
    }

    // Check if token is near expiry (e.g., less than 5 minutes left)
    const now = Math.floor(Date.now() / 1000);
    const timeLeft = decoded.exp - now;

    if (timeLeft < 5 * 60) {
        // Issue new token with extended expiration
        const newToken = appService.createSessionToken(decoded.user_id, currentTokenVersion, decoded.sid);

        setSessionCookie(res, newToken);
    }

    return "ok";
}

/** Gate for `/api/rest/*` JSON endpoints - see this file's top comment. */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    const resolution = await resolveSession(req, res);

    if (resolution === "no-token") {
        return res.redirect("/login");
    }
    if (resolution === "unauthorized") {
        return res.status(401).json({message: "Unauthorized", sessionExpired: true});
    }

    next();
};

/** Gate for the server-rendered `/app`/`/app/*` HTML routes - see this file's top comment. */
export const requireAuthPage = async (req: Request, res: Response, next: NextFunction) => {
    const resolution = await resolveSession(req, res);

    if (resolution === "no-token" || resolution === "unauthorized") {
        return res.redirect("/login");
    }

    next();
};
