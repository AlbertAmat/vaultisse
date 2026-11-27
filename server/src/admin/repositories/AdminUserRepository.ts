/** Data access for `admin_users` and `admin_sessions` - the portal's own accounts, separate from the regular `users`. */
import crypto from "crypto";
import {Pool} from "pg";

export type AdminRole = "superadmin" | "readonly";

export interface AdminUserRow {
    id: number;
    email: string;
    name: string;
    role: AdminRole;
    disabled: boolean;
    mustChangePassword: boolean;
    tokenVersion: number;
    totpEnabled: boolean;
    createdDate: Date;
    lastLoginDate: Date | null;
}

/** An admin including the credentials needed to log in. */
export interface AdminLoginRow extends AdminUserRow {
    password: string;
    totpSecret: string | null;
    totpLastUsedStep: number | null;
    failedLoginCount: number;
    lockoutUntil: Date | null;
}

export interface AdminSessionRow {
    id: number;
    adminId: number;
    createdDate: Date;
    lastSeenDate: Date;
    reauthUntil: Date | null;
}

const PUBLIC_COLUMNS = `id, email, name, role, disabled, must_change_password AS "mustChangePassword", token_version AS "tokenVersion", totp_enabled AS "totpEnabled",
                        created_date AS "createdDate", last_login_date AS "lastLoginDate"`;

/** Hash stored for a backup code. */
export function hashBackupCode(code: string): string {
    return crypto.createHash("sha256").update(code).digest("hex");
}

/** Data access for admin accounts and their sessions. */
export class AdminUserRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /** @returns Every admin account. */
    public async list(): Promise<AdminUserRow[]> {
        const result = await this.db.query(`SELECT ${PUBLIC_COLUMNS} FROM admin_users ORDER BY id`);
        return result.rows;
    }

    /**
     * @param id Admin id.
     * @returns The admin, or null.
     */
    public async findById(id: number): Promise<AdminUserRow | null> {
        const result = await this.db.query(`SELECT ${PUBLIC_COLUMNS} FROM admin_users WHERE id = $1`, [id]);
        return result.rows[0] ?? null;
    }

    /**
     * @param email Email (case-insensitive).
     * @returns The admin with login credentials, or null.
     */
    public async findForLogin(email: string): Promise<AdminLoginRow | null> {
        const result = await this.db.query(
            `SELECT ${PUBLIC_COLUMNS}, password, totp_secret AS "totpSecret", totp_last_used_step AS "totpLastUsedStep",
                    failed_login_count AS "failedLoginCount", lockout_until AS "lockoutUntil"
               FROM admin_users WHERE LOWER(email) = LOWER($1)`,
            [email]
        );
        return result.rows[0] ?? null;
    }

    /**
     * @param id Admin id.
     * @returns The admin with login credentials, or null.
     */
    public async findLoginById(id: number): Promise<AdminLoginRow | null> {
        const result = await this.db.query(
            `SELECT ${PUBLIC_COLUMNS}, password, totp_secret AS "totpSecret", totp_last_used_step AS "totpLastUsedStep",
                    failed_login_count AS "failedLoginCount", lockout_until AS "lockoutUntil"
               FROM admin_users WHERE id = $1`,
            [id]
        );
        return result.rows[0] ?? null;
    }

    /**
     * @param fields New admin.
     * @returns The new admin's id.
     * @throws The raw pg error (23505 on a duplicate email).
     */
    public async create(fields: {email: string; name: string; passwordHash: string; role: AdminRole; mustChangePassword?: boolean}): Promise<number> {
        const result = await this.db.query(
            `INSERT INTO admin_users (email, name, password, role, must_change_password) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [fields.email, fields.name, fields.passwordHash, fields.role, fields.mustChangePassword ?? false]
        );
        return result.rows[0].id;
    }

    /**
     * Updates the role and/or disabled flag; either change also ends the admin's sessions.
     * @param id Admin id.
     * @param fields Fields to change.
     */
    public async update(id: number, fields: {role?: AdminRole; disabled?: boolean; name?: string}): Promise<void> {
        await this.db.query(
            `UPDATE admin_users SET role = COALESCE($2, role), disabled = COALESCE($3, disabled), name = COALESCE($4, name),
                    token_version = token_version + CASE WHEN $2 IS NOT NULL OR $3 IS NOT NULL THEN 1 ELSE 0 END
              WHERE id = $1`,
            [id, fields.role ?? null, fields.disabled ?? null, fields.name ?? null]
        );
    }

    /**
     * Sets a new password and ends every session (token_version bump) except the one given.
     * @param id Admin id.
     * @param passwordHash New bcrypt hash.
     */
    public async setPassword(id: number, passwordHash: string, mustChangePassword: boolean = false): Promise<number> {
        const result = await this.db.query(
            `UPDATE admin_users SET password = $2, must_change_password = $3, token_version = token_version + 1, failed_login_count = 0, lockout_until = NULL
              WHERE id = $1 RETURNING token_version AS "tokenVersion"`,
            [id, passwordHash, mustChangePassword]
        );
        return result.rows[0].tokenVersion;
    }

    /**
     * @param id Admin id.
     * @returns Whether anything was deleted.
     */
    public async delete(id: number): Promise<boolean> {
        const result = await this.db.query("DELETE FROM admin_users WHERE id = $1", [id]);
        return (result.rowCount ?? 0) > 0;
    }

    /** @returns Number of admin accounts of any kind. */
    public async count(): Promise<number> {
        const result = await this.db.query("SELECT COUNT(*)::int AS total FROM admin_users");
        return result.rows[0].total;
    }

    /** @returns Number of enabled superadmins (so the last one can't be removed). */
    public async countActiveSuperadmins(): Promise<number> {
        const result = await this.db.query("SELECT COUNT(*)::int AS total FROM admin_users WHERE role = 'superadmin' AND disabled = FALSE");
        return result.rows[0].total;
    }

    /**
     * Stores a freshly generated, not yet confirmed TOTP secret.
     * @param id Admin id.
     * @param secret Base32 secret.
     */
    public async setTotpSecret(id: number, secret: string): Promise<void> {
        await this.db.query("UPDATE admin_users SET totp_secret = $2, totp_enabled = FALSE WHERE id = $1", [id, secret]);
    }

    /**
     * Turns two-factor on after the first code was confirmed.
     * @param id Admin id.
     * @param backupCodeHashes Hashes of the one-time backup codes.
     * @param step TOTP step of the confirming code (blocks its replay).
     */
    public async enableTotp(id: number, backupCodeHashes: string[], step: number): Promise<void> {
        await this.db.query(
            "UPDATE admin_users SET totp_enabled = TRUE, backup_code_hashes = $2, totp_last_used_step = $3 WHERE id = $1",
            [id, backupCodeHashes, step]
        );
    }

    /**
     * Removes two-factor so the admin must enrol again, ending all their sessions.
     * @param id Admin id.
     */
    public async resetTotp(id: number): Promise<void> {
        await this.db.query(
            `UPDATE admin_users SET totp_enabled = FALSE, totp_secret = NULL, totp_last_used_step = NULL,
                    backup_code_hashes = '{}', token_version = token_version + 1 WHERE id = $1`,
            [id]
        );
    }

    /**
     * Records the TOTP step that was just used, so the same code can't be replayed.
     * @param id Admin id.
     * @param step Step number.
     */
    public async setTotpStep(id: number, step: number): Promise<void> {
        await this.db.query("UPDATE admin_users SET totp_last_used_step = $2 WHERE id = $1", [id, step]);
    }

    /**
     * Spends a backup code.
     * @param id Admin id.
     * @param codeHash Hash of the code.
     * @returns Whether it was one of the admin's unused codes.
     */
    public async consumeBackupCode(id: number, codeHash: string): Promise<boolean> {
        const result = await this.db.query(
            `UPDATE admin_users SET backup_code_hashes = array_remove(backup_code_hashes, $2)
              WHERE id = $1 AND $2 = ANY(backup_code_hashes)`,
            [id, codeHash]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Counts a wrong password/code and locks the account once `maxAttempts` is reached.
     * @param id Admin id.
     * @param maxAttempts Failures allowed in a row.
     * @param lockoutUntil When the lockout ends if it triggers.
     */
    public async recordFailure(id: number, maxAttempts: number, lockoutUntil: Date): Promise<void> {
        await this.db.query(
            `UPDATE admin_users SET failed_login_count = failed_login_count + 1,
                    lockout_until = CASE WHEN failed_login_count + 1 >= $2 THEN $3::timestamptz ELSE lockout_until END
              WHERE id = $1`,
            [id, maxAttempts, lockoutUntil]
        );
    }

    /** @param id Admin id. */
    public async clearFailures(id: number): Promise<void> {
        await this.db.query("UPDATE admin_users SET failed_login_count = 0, lockout_until = NULL WHERE id = $1", [id]);
    }

    /** @param id Admin id. */
    public async touchLastLogin(id: number): Promise<void> {
        await this.db.query("UPDATE admin_users SET last_login_date = CURRENT_TIMESTAMP WHERE id = $1", [id]);
    }

    /**
     * @param adminId Admin id.
     * @param userAgent Browser.
     * @param ip Client address.
     * @returns The new session.
     */
    public async createSession(adminId: number, userAgent: string | undefined, ip: string | undefined): Promise<{id: number; sessionKey: string}> {
        const sessionKey = crypto.randomUUID();
        const result = await this.db.query(
            `INSERT INTO admin_sessions (admin_id, session_key, user_agent, ip_address) VALUES ($1, $2, $3, $4) RETURNING id`,
            [adminId, sessionKey, userAgent?.slice(0, 300) ?? null, ip ?? null]
        );
        return {id: result.rows[0].id, sessionKey};
    }

    /**
     * @param sessionKey The JWT's `sid`.
     * @param adminId Admin id.
     * @returns The session unless it was revoked.
     */
    public async findActiveSession(sessionKey: string, adminId: number): Promise<AdminSessionRow | null> {
        const result = await this.db.query(
            `SELECT id, admin_id AS "adminId", created_date AS "createdDate", last_seen_date AS "lastSeenDate", reauth_until AS "reauthUntil"
               FROM admin_sessions WHERE session_key = $1 AND admin_id = $2 AND revoked_date IS NULL`,
            [sessionKey, adminId]
        );
        return result.rows[0] ?? null;
    }

    /** @param sessionId Session id. */
    public async touchSession(sessionId: number): Promise<void> {
        await this.db.query("UPDATE admin_sessions SET last_seen_date = CURRENT_TIMESTAMP WHERE id = $1", [sessionId]);
    }

    /**
     * @param sessionId Session id.
     * @param until When the fresh verification lapses.
     */
    public async setReauth(sessionId: number, until: Date): Promise<void> {
        await this.db.query("UPDATE admin_sessions SET reauth_until = $2 WHERE id = $1", [sessionId, until]);
    }

    /** @param sessionId Session id. */
    public async revokeSession(sessionId: number): Promise<void> {
        await this.db.query("UPDATE admin_sessions SET revoked_date = CURRENT_TIMESTAMP WHERE id = $1 AND revoked_date IS NULL", [sessionId]);
    }

    /**
     * @param adminId Admin id.
     * @param exceptSessionId Session to keep.
     */
    public async revokeOtherSessions(adminId: number, exceptSessionId: number): Promise<void> {
        await this.db.query(
            "UPDATE admin_sessions SET revoked_date = CURRENT_TIMESTAMP WHERE admin_id = $1 AND id <> $2 AND revoked_date IS NULL",
            [adminId, exceptSessionId]
        );
    }

    /**
     * Deletes sessions that can no longer be used.
     * @param before Sessions last seen before this are removed.
     */
    public async purgeSessions(before: Date): Promise<void> {
        await this.db.query("DELETE FROM admin_sessions WHERE last_seen_date < $1 OR revoked_date < $1", [before]);
    }
}
