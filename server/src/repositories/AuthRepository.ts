/**
 * Data access for password login/registration/logout and the per-request
 * session check in AuthMiddleware.ts. Deliberately kept as its own
 * repository, separate from UserRepository.ts (self-service account
 * management), so every query touching authentication/authorization sits
 * in one small, easy-to-audit file - see AuthService.ts for the business
 * rules built on top of it.
 */
import {Pool, PoolClient} from "pg";
import {BackupCode, LoginCandidate, NewUserFields, PendingTwoFactorUser} from "../types/auth";

export async function findLoginCandidate(db: Pool | PoolClient, usernameOrEmail: string): Promise<LoginCandidate | null> {
    const result = await db.query(
        `SELECT id, code, password, token_version AS "tokenVersion", totp_enabled AS "totpEnabled"
           FROM users
          WHERE (code = $1 OR email = $2) AND disabled = FALSE`,
        [usernameOrEmail, usernameOrEmail]
    );
    return result.rows[0] ?? null;
}

export async function findPendingTwoFactorUser(db: Pool | PoolClient, userId: number): Promise<PendingTwoFactorUser | null> {
    const result = await db.query(
        `SELECT id, token_version AS "tokenVersion", totp_secret AS "totpSecret"
           FROM users
          WHERE id = $1 AND disabled = FALSE AND totp_enabled = TRUE`,
        [userId]
    );
    return result.rows[0] ?? null;
}

export async function updateLastLogin(db: Pool | PoolClient, userId: number): Promise<void> {
    await db.query(`UPDATE users SET last_login_date = CURRENT_TIMESTAMP WHERE id = $1`, [userId]);
}

export async function listUnusedBackupCodes(db: Pool | PoolClient, userId: number): Promise<BackupCode[]> {
    const result = await db.query(
        `SELECT id, code_hash AS "codeHash" FROM user_backup_codes WHERE user_id = $1 AND used_date IS NULL`,
        [userId]
    );
    return result.rows;
}

export async function markBackupCodeUsed(db: Pool | PoolClient, id: number): Promise<void> {
    await db.query(`UPDATE user_backup_codes SET used_date = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
}

/** @returns The new row's id. Throws the raw pg error (code 23505 on a duplicate code/email) - AuthService maps that to a domain error. */
export async function register(db: Pool | PoolClient, fields: NewUserFields): Promise<number> {
    const result = await db.query(
        `INSERT INTO users (name, code, email, password, disabled)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [fields.name, fields.code, fields.email, fields.passwordHash, fields.disabled]
    );
    return result.rows[0].id;
}

/** @returns Whether a matching, not-already-revoked session was found and revoked. */
export async function revokeSessionByKey(db: Pool | PoolClient, sessionKey: string, userId: number): Promise<boolean> {
    const result = await db.query(
        `UPDATE user_sessions
            SET revoked_date = NOW()
          WHERE session_key = $1 AND user_id = $2 AND revoked_date IS NULL
        RETURNING id`,
        [sessionKey, userId]
    );
    return (result.rowCount ?? 0) > 0;
}

/**
 * Used by AuthMiddleware.resolveSession on every authenticated request -
 * both for the real token's `token_version` check and for the
 * `ALLOW_DEV_AUTH` fake-user lookup (same predicate, different id).
 * Deliberate simplification: the original had two near-identical inline
 * queries here (one via a named prepared statement selecting `id,
 * token_version`, one plain selecting just `token_version` for the dev
 * path) - consolidated into one function since the effective query is the
 * same. Drops the `name: "user-prep-stmt"` server-side prepared-statement
 * hint as a minor, deliberate simplification (not a behavior change).
 */
export async function getActiveUserTokenVersion(db: Pool | PoolClient, userId: number): Promise<number | null> {
    const result = await db.query(
        `SELECT token_version FROM users WHERE id = $1 AND disabled = FALSE`,
        [userId]
    );
    return result.rows[0]?.token_version ?? null;
}
