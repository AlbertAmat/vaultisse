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

/** Data access for password login/registration/logout and AuthMiddleware's per-request session check. */
export class AuthRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Looks up an active (non-disabled) user by code or email, for password login.
     * @param usernameOrEmail Either the user's code or email.
     * @returns The login candidate, or null if none matches.
     */
    public async findLoginCandidate(usernameOrEmail: string): Promise<LoginCandidate | null> {
        const result = await this.db.query(
            `SELECT id, code, password, token_version AS "tokenVersion", totp_enabled AS "totpEnabled"
               FROM users
              WHERE (code = $1 OR email = $2) AND disabled = FALSE`,
            [usernameOrEmail, usernameOrEmail]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Looks up an active, 2FA-enabled user by id, for the second login step.
     * @param userId User id from the pending-2FA token.
     * @returns The pending user, or null if it doesn't exist/isn't 2FA-enabled/is disabled.
     */
    public async findPendingTwoFactorUser(userId: number): Promise<PendingTwoFactorUser | null> {
        const result = await this.db.query(
            `SELECT id, token_version AS "tokenVersion", totp_secret AS "totpSecret"
               FROM users
              WHERE id = $1 AND disabled = FALSE AND totp_enabled = TRUE`,
            [userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Records a successful login.
     * @param userId Owning user's id.
     */
    public async updateLastLogin(userId: number): Promise<void> {
        await this.db.query(`UPDATE users SET last_login_date = CURRENT_TIMESTAMP WHERE id = $1`, [userId]);
    }

    /**
     * Lists a user's unused backup codes, for the 2FA-login fallback.
     * @param userId Owning user's id.
     * @returns Every unused backup code.
     */
    public async listUnusedBackupCodes(userId: number): Promise<BackupCode[]> {
        const result = await this.db.query(
            `SELECT id, code_hash AS "codeHash" FROM user_backup_codes WHERE user_id = $1 AND used_date IS NULL`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Marks one backup code as used, so it can't be replayed.
     * @param id Backup code row id.
     */
    public async markBackupCodeUsed(id: number): Promise<void> {
        await this.db.query(`UPDATE user_backup_codes SET used_date = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
    }

    /**
     * Registers a new user account.
     * @param fields New account fields.
     * @returns The new row's id.
     * @throws The raw pg error (code 23505 on a duplicate code/email) - AuthService maps that to a domain error.
     */
    public async register(fields: NewUserFields): Promise<number> {
        const result = await this.db.query(
            `INSERT INTO users (name, code, email, password, disabled)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [fields.name, fields.code, fields.email, fields.passwordHash, fields.disabled]
        );
        return result.rows[0].id;
    }

    /**
     * Revokes one session by its key, for logout.
     * @param sessionKey Session key (the JWT's `sid` claim).
     * @param userId Owning user's id.
     * @returns Whether a matching, not-already-revoked session was found and revoked.
     */
    public async revokeSessionByKey(sessionKey: string, userId: number): Promise<boolean> {
        const result = await this.db.query(
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
     *
     * @param userId User id to check.
     * @returns The current token_version, or null if the user doesn't exist or is disabled.
     */
    public async getActiveUserTokenVersion(userId: number): Promise<number | null> {
        const result = await this.db.query(
            `SELECT token_version FROM users WHERE id = $1 AND disabled = FALSE`,
            [userId]
        );
        return result.rows[0]?.token_version ?? null;
    }
}
