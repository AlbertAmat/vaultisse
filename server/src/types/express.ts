/**
 * Augments Express's Request with fields `requireAuth` (AuthMiddleware.ts)
 * attaches after validating a session, so downstream handlers (password
 * change, logout, session management in UserRoute.ts) can use them without
 * re-decoding the JWT or re-querying the DB.
 */
import {VaultPermissions} from "./vault";

export {};

// Deliberately a .ts file, not .d.ts: the side-effect import in AppService.ts
// (needed so the type-checker is guaranteed to load this file and merge the
// augmentation below - it won't otherwise, since nothing else imports it) has
// to resolve at runtime too (tsx in dev, esbuild's bundle in production), and
// a .d.ts can't be run or bundled. A .ts file works both for type-checking
// and at runtime.
declare global {
    namespace Express {
        interface Request {
            /** DB id of the current `user_sessions` row. Unset only when ALLOW_DEV_AUTH bypasses real sessions. */
            sessionId?: number;
            /** Opaque session key (the JWT's `sid` claim) for the current session. Unset only when ALLOW_DEV_AUTH bypasses real sessions. */
            sessionKey?: string;
            /**
             * The caller's active vault (`users.last_used_vault_id`) - every
             * catalog resource (books, categories, authors, locations,
             * customers, loans, dashboard) is scoped to this, not to the
             * user directly (issue #7, multi-user vault sharing). Set
             * whenever the session resolves to a user with an active vault;
             * a user with none (shouldn't happen outside test setup races -
             * registration/OIDC JIT-create always provisions one) leaves
             * this unset, and vault-scoped routes should treat that as
             * "no vault to act in" rather than assume it's always present.
             */
            vaultId?: number;
            /**
             * The caller's role permissions in `vaultId`, set alongside it -
             * only ever from an ACCEPTED `vault_users` row. Checked per route
             * by `requireVaultPermission` (VaultPermissionMiddleware.ts).
             */
            vaultPermissions?: VaultPermissions;
        }
    }
}
