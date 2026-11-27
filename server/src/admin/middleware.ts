/**
 * Guards of the admin API.
 *
 *  - {@link ipAllowlist}: optional `ADMIN_ALLOWED_IPS` restriction.
 *  - {@link sameOriginOnly}: rejects browser requests coming from a page on another origin (CSRF defence,
 *    on top of the SameSite=Strict cookie and JSON-only bodies).
 *  - {@link requireAdmin}: the request must carry a valid admin session; sets `req.admin`.
 *  - {@link requireSuperadmin}: the admin must be allowed to change things (a `readonly` admin can only look).
 *  - {@link requireFreshAuth}: dangerous actions need a password + code verification from the last 5 minutes.
 */
import {NextFunction, Request, Response} from "express";
import {AdminConfig} from "./AdminConfig";
import {ADMIN_COOKIE, clearSessionCookie, setAdminCookie} from "./http";
import {AdminAuthService, SESSION_IDLE_MS} from "./services/AdminAuthService";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * @param config Admin bootstrap config.
 * @returns Middleware answering 403 to addresses outside `ADMIN_ALLOWED_IPS` (a no-op when it is empty).
 */
export function ipAllowlist(config: AdminConfig) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (config.allowedIps.length > 0 && !config.allowedIps.includes(req.ip ?? "")) {
            res.status(403).type("text/plain").send("Forbidden");
            return;
        }
        next();
    };
}

/**
 * @param config Admin bootstrap config.
 * @returns Middleware refusing state-changing requests whose `Origin` isn't the admin app's own.
 *          Requests without an `Origin` header (curl, server-to-server) pass: they can't carry a victim's cookie.
 */
export function sameOriginOnly(config: AdminConfig) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (SAFE_METHODS.has(req.method)) {
            next();
            return;
        }
        const origin = req.headers.origin;
        if (origin) {
            const allowed = config.url ?? `${req.protocol}://${req.headers.host}`;
            if (origin !== allowed) {
                res.status(403).json({message: "Cross-origin request refused."});
                return;
            }
        }
        // A body that isn't JSON can't come from our own app; refuse it (form posts are the classic CSRF vector).
        if (req.is("application/json") === false) {
            res.status(415).json({message: "JSON body required."});
            return;
        }
        next();
    };
}

/**
 * @param auth The admin auth service.
 * @returns Middleware requiring a valid admin session.
 */
export function requireAdmin(auth: AdminAuthService) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const resolved = await auth.resolveSession(req.cookies?.[ADMIN_COOKIE]);
            if (!resolved) {
                clearSessionCookie(res);
                res.status(401).json({message: "Unauthorized", sessionExpired: true});
                return;
            }
            req.admin = resolved.admin;
            if (resolved.refreshedToken) {
                setAdminCookie(res, resolved.refreshedToken, SESSION_IDLE_MS);
            }
            next();
        } catch (error) {
            next(error);
        }
    };
}

/**
 * Middleware: an admin who still has the generated (or admin-set) password can't do anything but change
 * it. Mounted after {@link requireAdmin} on everything except the `/auth/*` routes, which stay reachable.
 */
export function blockUntilPasswordChanged(req: Request, res: Response, next: NextFunction): void {
    if (req.admin?.mustChangePassword) {
        res.status(403).json({message: "Choose a new password before continuing.", passwordChangeRequired: true});
        return;
    }
    next();
}

/** Middleware: only superadmins may continue. */
export function requireSuperadmin(req: Request, res: Response, next: NextFunction): void {
    if (req.admin?.role !== "superadmin") {
        res.status(403).json({message: "Your admin account is read-only."});
        return;
    }
    next();
}

/** Middleware: the session must have passed a fresh password + code check (POST /auth/reauth) recently. */
export function requireFreshAuth(req: Request, res: Response, next: NextFunction): void {
    const until = req.admin?.reauthUntil;
    if (!until || until.getTime() < Date.now()) {
        res.status(403).json({message: "Confirm your password and code to continue.", reauthRequired: true});
        return;
    }
    next();
}
