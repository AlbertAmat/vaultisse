/**
 * Augments Express's Request with fields `requireAuth` (AuthMiddleware.ts)
 * attaches after validating a session, so downstream handlers (password
 * change, logout, session management in UserRoute.ts) can use them without
 * re-decoding the JWT or re-querying the DB.
 */
export {};

// Deliberately a .ts file, not .d.ts: a .d.ts is never emitted, so the
// side-effect import in AppService.ts (needed so ts-node's language service
// is guaranteed to load this file and merge the augmentation below - it
// won't otherwise, since nothing else imports it) would fail to resolve at
// runtime with MODULE_NOT_FOUND. A .ts file compiles to a real (near-empty)
// JS file, so the same import works both for type-checking and at runtime.
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
        }
    }
}
