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

export const SESSION_COOKIE = "token";
export const PENDING_2FA_COOKIE = "pending_2fa_token";
export const OIDC_PENDING_COOKIE = "oidc_pending";
export const OIDC_PENDING_MAX_AGE_MS = 10 * 60 * 1000;
const PENDING_2FA_MAX_AGE_MS = 5 * 60 * 1000;

function laxCookieOptions(): CookieOptions {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
    };
}

function legacyStrictClearOptions(): CookieOptions {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
    };
}

export function sessionCookieOptions(): CookieOptions {
    return {
        ...laxCookieOptions(),
        maxAge: Number(process.env.SESSION_TIME),
    };
}

export function sessionClearCookieOptions(): CookieOptions {
    return laxCookieOptions();
}

export function setSessionCookie(res: Response, token: string): void {
    res.clearCookie(SESSION_COOKIE, legacyStrictClearOptions());
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, sessionClearCookieOptions());
    res.clearCookie(SESSION_COOKIE, legacyStrictClearOptions());
}

export function setPending2faCookie(res: Response, token: string): void {
    res.clearCookie(PENDING_2FA_COOKIE, legacyStrictClearOptions());
    res.cookie(PENDING_2FA_COOKIE, token, {
        ...laxCookieOptions(),
        maxAge: PENDING_2FA_MAX_AGE_MS,
    });
}

export function clearPending2faCookie(res: Response): void {
    res.clearCookie(PENDING_2FA_COOKIE, laxCookieOptions());
    res.clearCookie(PENDING_2FA_COOKIE, legacyStrictClearOptions());
}

export function setOidcPendingCookie(res: Response, token: string): void {
    res.cookie(OIDC_PENDING_COOKIE, token, {
        ...laxCookieOptions(),
        maxAge: OIDC_PENDING_MAX_AGE_MS,
    });
}

export function clearOidcPendingCookie(res: Response): void {
    res.clearCookie(OIDC_PENDING_COOKIE, laxCookieOptions());
}
