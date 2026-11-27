/** Small helpers shared by the admin routes: cookies, error mapping, id/paging parsing. */
import {CookieOptions, NextFunction, Request, RequestHandler, Response} from "express";
import {DomainError, ValidationError} from "../errors/DomainError";

export const ADMIN_COOKIE = "admin_token";
export const ADMIN_PENDING_COOKIE = "admin_pending";

/** Strict SameSite: the portal is a separate site, nothing legitimate navigates into it carrying the cookie. */
function baseCookie(): CookieOptions {
    return {httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/"};
}

/**
 * @param res Express response.
 * @param token Session JWT.
 * @param maxAgeMs Cookie lifetime.
 */
export function setAdminCookie(res: Response, token: string, maxAgeMs: number): void {
    res.cookie(ADMIN_COOKIE, token, {...baseCookie(), maxAge: maxAgeMs});
}

/** Ends the session cookie only - a half-finished login (the pending cookie) must survive an unauthenticated probe. @param res Express response. */
export function clearSessionCookie(res: Response): void {
    res.clearCookie(ADMIN_COOKIE, baseCookie());
}

/** @param res Express response. */
export function clearAdminCookies(res: Response): void {
    res.clearCookie(ADMIN_COOKIE, baseCookie());
    res.clearCookie(ADMIN_PENDING_COOKIE, baseCookie());
}

/**
 * @param res Express response.
 * @param token Pending (second step) JWT.
 */
export function setPendingCookie(res: Response, token: string): void {
    res.cookie(ADMIN_PENDING_COOKIE, token, {...baseCookie(), maxAge: 5 * 60 * 1000});
}

/** @param res Express response. */
export function clearPendingCookie(res: Response): void {
    res.clearCookie(ADMIN_PENDING_COOKIE, baseCookie());
}

/**
 * Wraps an async route handler: domain errors become `{message}` with their status, anything else a logged 500.
 * @param fn The handler.
 * @returns An Express handler.
 */
export function handle(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        fn(req, res).catch((error: unknown) => {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).json({message: error.message});
                return;
            }
            console.error("Admin request failed", error instanceof Error ? error.stack : error);
            if (!res.headersSent) {
                res.status(500).json({message: "Internal Server Error"});
            } else {
                next(error);
            }
        });
    };
}

/**
 * @param req Express request.
 * @param name Route parameter name.
 * @returns The parameter as a positive integer.
 * @throws ValidationError when it isn't one.
 */
export function idParam(req: Request, name: string = "id"): number {
    const value = Number(req.params[name]);
    if (!Number.isInteger(value) || value <= 0) {
        throw new ValidationError("Invalid id.");
    }
    return value;
}

/**
 * @param req Express request.
 * @param maxPageSize Largest page size accepted.
 * @returns Page, size, limit and offset from `?page=&pageSize=`.
 */
export function paging(req: Request, maxPageSize: number = 100): {page: number; pageSize: number; limit: number; offset: number} {
    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const pageSize = Math.min(maxPageSize, Math.max(1, Math.floor(Number(req.query.pageSize)) || 25));
    return {page, pageSize, limit: pageSize, offset: (page - 1) * pageSize};
}

/**
 * @param value A query/body value.
 * @returns The value if it is a non-empty string, else undefined.
 */
export function text(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
