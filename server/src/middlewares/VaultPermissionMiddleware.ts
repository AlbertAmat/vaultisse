/**
 * Per-route role check for vault-scoped catalog writes (issue #7). Must run
 * after `requireAuth` (AuthMiddleware.ts), which attaches
 * `req.vaultPermissions` from the caller's ACCEPTED membership in their
 * active vault - and before any multer upload middleware, so a caller who
 * isn't allowed to write never gets a file buffered into memory either.
 *
 * Usage: `router.post('', requireAuth, requireVaultPermission("canEditCatalog"), handler)`.
 * Failure: 403 `{error: "..."}`, same message VaultService's ForbiddenError uses.
 *
 * Without this, `vault_roles.can_edit_catalog`/`can_borrow` were defined but
 * never checked, so a readonly member could create/edit/delete anything in
 * the vault (security audit #1).
 */
import {Request, Response, NextFunction, RequestHandler} from "express";
import {VaultPermissions} from "../types/vault";

/**
 * Builds a middleware that rejects the request unless the caller holds `permission` in their active vault.
 * @param permission The VaultPermissions flag the route requires.
 * @returns Express middleware - 403 when the flag is missing/false (or there's no active vault at all), otherwise `next()`.
 */
export function requireVaultPermission(permission: keyof VaultPermissions): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.vaultPermissions?.[permission]) {
            res.status(403).json({error: "You don't have permission to do that in this vault"});
            return;
        }
        next();
    };
}
