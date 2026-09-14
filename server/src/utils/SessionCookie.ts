/**
 * Auth cookie flags. Set and clear must use the same path / SameSite /
 * Secure / HttpOnly or the browser keeps the old cookie.
 *
 * SameSite=Lax (not Strict): the OIDC callback is a top-level GET from the
 * IdP. A Strict cookie set on that response is not sent on the following
 * redirect to /app, so the previous user's leftover cookie would keep
 * winning. Lax is still withheld from cross-site POSTs (CSRF).
 *
 * Chrome treats SameSite as part of the cookie identity, so after this
 * change an old Strict `token` (or `pending_2fa_token`) can sit next to
 * the new Lax one. Clear both on write and on logout.
 */
import {CookieOptions, Response} from "express";

/** Auth cookie option builders and set/clear helpers. A static-only utility class - stateless, no DB access, same treatment as BookMetadataRepository.ts. Kept in utils/ rather than folded into a service, since every method takes an Express `Response` directly and AuthMiddleware.ts (outside the repositories/services/controllers layers) depends on it too. */
export class SessionCookie {
    public static readonly SESSION_COOKIE = "token";
    public static readonly PENDING_2FA_COOKIE = "pending_2fa_token";
    public static readonly OIDC_PENDING_COOKIE = "oidc_pending";
    public static readonly OIDC_PENDING_MAX_AGE_MS = 10 * 60 * 1000;
    private static readonly PENDING_2FA_MAX_AGE_MS = 5 * 60 * 1000;

    /** Static-only utility class, never instantiated. */
    private constructor() {
    }

    /**
     * Shared cookie flags for the Lax-SameSite cookies (session/pending-2FA/oidc-pending).
     * @returns The base cookie options.
     */
    private static laxCookieOptions(): CookieOptions {
        return {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
        };
    }

    /**
     * Flags matching the old Strict-SameSite cookies this app used to set, so they can be cleared even after the Lax migration.
     * @returns The legacy cookie options.
     */
    private static legacyStrictClearOptions(): CookieOptions {
        return {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/",
        };
    }

    /**
     * Cookie options for setting the session token.
     * @returns The session cookie options, including its `maxAge`.
     */
    public static sessionCookieOptions(): CookieOptions {
        return {
            ...SessionCookie.laxCookieOptions(),
            maxAge: Number(process.env.SESSION_TIME),
        };
    }

    /**
     * Cookie options for clearing the session token.
     * @returns The session-clear cookie options.
     */
    public static sessionClearCookieOptions(): CookieOptions {
        return SessionCookie.laxCookieOptions();
    }

    /**
     * Sets the session-token cookie, clearing any leftover legacy-Strict one first.
     * @param res Express response.
     * @param token Session JWT.
     */
    public static setSessionCookie(res: Response, token: string): void {
        res.clearCookie(SessionCookie.SESSION_COOKIE, SessionCookie.legacyStrictClearOptions());
        res.cookie(SessionCookie.SESSION_COOKIE, token, SessionCookie.sessionCookieOptions());
    }

    /**
     * Clears the session-token cookie (both the current Lax form and any leftover legacy-Strict one).
     * @param res Express response.
     */
    public static clearSessionCookie(res: Response): void {
        res.clearCookie(SessionCookie.SESSION_COOKIE, SessionCookie.sessionClearCookieOptions());
        res.clearCookie(SessionCookie.SESSION_COOKIE, SessionCookie.legacyStrictClearOptions());
    }

    /**
     * Sets the pending-2FA cookie, clearing any leftover legacy-Strict one first.
     * @param res Express response.
     * @param token Pending-2FA JWT.
     */
    public static setPending2faCookie(res: Response, token: string): void {
        res.clearCookie(SessionCookie.PENDING_2FA_COOKIE, SessionCookie.legacyStrictClearOptions());
        res.cookie(SessionCookie.PENDING_2FA_COOKIE, token, {
            ...SessionCookie.laxCookieOptions(),
            maxAge: SessionCookie.PENDING_2FA_MAX_AGE_MS,
        });
    }

    /**
     * Clears the pending-2FA cookie (both the current Lax form and any leftover legacy-Strict one).
     * @param res Express response.
     */
    public static clearPending2faCookie(res: Response): void {
        res.clearCookie(SessionCookie.PENDING_2FA_COOKIE, SessionCookie.laxCookieOptions());
        res.clearCookie(SessionCookie.PENDING_2FA_COOKIE, SessionCookie.legacyStrictClearOptions());
    }

    /**
     * Sets the OIDC-pending cookie.
     * @param res Express response.
     * @param token Signed pending-authorization payload.
     */
    public static setOidcPendingCookie(res: Response, token: string): void {
        res.cookie(SessionCookie.OIDC_PENDING_COOKIE, token, {
            ...SessionCookie.laxCookieOptions(),
            maxAge: SessionCookie.OIDC_PENDING_MAX_AGE_MS,
        });
    }

    /**
     * Clears the OIDC-pending cookie.
     * @param res Express response.
     */
    public static clearOidcPendingCookie(res: Response): void {
        res.clearCookie(SessionCookie.OIDC_PENDING_COOKIE, SessionCookie.laxCookieOptions());
    }
}
