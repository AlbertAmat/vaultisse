/**
 * Data access for the admin portal's view of the installation: accounts, vaults and aggregate numbers.
 *
 * By design this only ever reads *metadata* - who exists, how big things are, what state they are in. It
 * never selects a vault's books, customers, loans or other content, and there is no "act as user": an
 * admin can lock, suspend or delete, but not look inside someone's library.
 */
import {Pool, PoolClient} from "pg";

export type UserStatusFilter = "active" | "pending" | "disabled" | "pending_deletion" | "unverified";

export interface UserListRow {
    id: number;
    code: string;
    name: string;
    email: string;
    disabled: boolean;
    disabledReason: string | null;
    emailVerified: boolean;
    totpEnabled: boolean;
    sso: boolean;
    createdDate: Date | null;
    lastLoginDate: Date | null;
    lastActivityDate: Date | null;
    vaultCount: number;
    deletionScheduledFor: Date | null;
    tags: string[];
    noteCount: number;
}

export interface UserMembership {
    vaultId: number;
    vaultName: string;
    role: string;
    status: number;
    suspended: boolean;
}

export interface VaultListRow {
    id: number;
    name: string;
    description: string | null;
    createdDate: Date | null;
    loansEnabled: boolean;
    suspendedAt: Date | null;
    suspendedReason: string | null;
    planId: number | null;
    planName: string | null;
    memberCount: number;
    admins: string[];
    bookCount: number;
    stockCount: number;
    storageBytes: number;
    deletionScheduledFor: Date | null;
}

export interface VaultMember {
    userId: number;
    code: string;
    name: string;
    role: string;
    status: number;
}

/** SQL for the bytes a vault stores: ebook files, data-URI covers, customer photos and the card background. */
export const VAULT_STORAGE_SQL = `
    COALESCE((SELECT SUM(file_size) FROM book_files WHERE vault_id = v.id), 0)
  + COALESCE((SELECT SUM(octet_length(image_url)) FROM books WHERE vault_id = v.id AND image_url LIKE 'data:%'), 0)
  + COALESCE((SELECT SUM(octet_length(image)) FROM customers WHERE vault_id = v.id), 0)
  + COALESCE((SELECT octet_length(background) FROM customer_card_settings WHERE vault_id = v.id), 0)`;

const USER_STATUS_SQL: Record<UserStatusFilter, string> = {
    active: "u.disabled = FALSE AND u.email_verified = TRUE",
    pending: "u.disabled = TRUE AND u.disabled_reason = 'pending_approval'",
    disabled: "u.disabled = TRUE AND COALESCE(u.disabled_reason, '') NOT IN ('pending_approval', 'pending_deletion')",
    pending_deletion: "u.disabled_reason = 'pending_deletion'",
    unverified: "u.email_verified = FALSE",
};

/** Cross-tenant metadata queries for the admin portal. */
export class PlatformRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /** @returns Headline numbers for the overview page. */
    public async overview(): Promise<Record<string, number>> {
        const result = await this.db.query(`
            SELECT
              (SELECT COUNT(*) FROM users)::int                                                                  AS "users",
              (SELECT COUNT(*) FROM users WHERE disabled AND disabled_reason = 'pending_approval')::int          AS "usersPending",
              (SELECT COUNT(*) FROM users WHERE disabled AND COALESCE(disabled_reason, '') <> 'pending_approval')::int AS "usersDisabled",
              (SELECT COUNT(*) FROM users WHERE email_verified = FALSE)::int                                     AS "usersUnverified",
              (SELECT COUNT(*) FROM users WHERE totp_enabled)::int                                               AS "usersWithTwoFactor",
              (SELECT COUNT(*) FROM users WHERE oidc_sub IS NOT NULL)::int                                       AS "usersSso",
              (SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE revoked_date IS NULL AND last_seen_date > NOW() - INTERVAL '15 minutes')::int AS "activeNow",
              (SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE last_seen_date > NOW() - INTERVAL '1 day')::int   AS "activeDay",
              (SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE last_seen_date > NOW() - INTERVAL '7 days')::int  AS "activeWeek",
              (SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE last_seen_date > NOW() - INTERVAL '30 days')::int AS "activeMonth",
              (SELECT COUNT(*) FROM users WHERE created_date > NOW() - INTERVAL '7 days')::int                   AS "signupsWeek",
              (SELECT COUNT(*) FROM vault)::int                                                                  AS "vaults",
              (SELECT COUNT(*) FROM vault WHERE suspended_at IS NOT NULL)::int                                   AS "vaultsSuspended",
              (SELECT COUNT(*) FROM (SELECT vault_id FROM vault_users WHERE status = 1 GROUP BY vault_id HAVING COUNT(*) > 1) shared)::int AS "vaultsShared",
              (SELECT COUNT(*) FROM books)::int                                                                  AS "books",
              (SELECT COUNT(*) FROM book_stocks)::int                                                            AS "stocks",
              (SELECT COALESCE(SUM(file_size), 0) FROM book_files)::bigint                                       AS "fileBytes",
              (SELECT COUNT(*) FROM scheduled_deletions WHERE cancelled_at IS NULL AND executed_at IS NULL)::int AS "pendingDeletions",
              (SELECT COUNT(*) FROM admin_audit_log WHERE action = 'auth.login_failed' AND created_date > NOW() - INTERVAL '24 hours')::int AS "adminFailed24h",
              (SELECT COUNT(DISTINCT ip_address) FROM admin_audit_log WHERE action = 'auth.login_failed' AND created_date > NOW() - INTERVAL '24 hours')::int AS "adminFailedIps24h",
              (SELECT COUNT(*) FROM (SELECT DISTINCT ON (job_id) status FROM job_runs ORDER BY job_id, started_at DESC) j WHERE j.status = 'failed')::int AS "failedJobs"
        `);
        const row = result.rows[0];
        return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
    }

    /**
     * @param days Number of days back.
     * @returns New accounts per day (days without any included as 0).
     */
    public async signupsPerDay(days: number): Promise<{day: string; count: number}[]> {
        return this.perDay(`SELECT created_date::date AS day, COUNT(*)::int AS count FROM users WHERE created_date >= CURRENT_DATE - $1::int GROUP BY 1`, days);
    }

    /**
     * @param days Number of days back.
     * @returns Successful logins per day (days without any included as 0).
     */
    public async loginsPerDay(days: number): Promise<{day: string; count: number}[]> {
        return this.perDay(`SELECT created_date::date AS day, COUNT(*)::int AS count FROM activity_log WHERE action = 'login' AND created_date >= CURRENT_DATE - $1::int GROUP BY 1`, days);
    }

    private async perDay(sql: string, days: number): Promise<{day: string; count: number}[]> {
        const result = await this.db.query(
            `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(x.count, 0)::int AS count
               FROM generate_series(CURRENT_DATE - $1::int, CURRENT_DATE, '1 day') AS d(day)
               LEFT JOIN (${sql}) x ON x.day = d.day::date
              ORDER BY d.day`,
            [days]
        );
        return result.rows;
    }

    /**
     * @param filters Search text and status filter.
     * @param sort Sort key.
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of accounts and the total number matching.
     */
    public async listUsers(filters: {search?: string; status?: UserStatusFilter; tag?: string}, sort: "created" | "lastLogin" | "name", limit: number, offset: number): Promise<{rows: UserListRow[]; total: number}> {
        const params: unknown[] = [];
        const where: string[] = [];
        if (filters.search) {
            params.push(`%${filters.search.replace(/[%_\\]/g, "\\$&")}%`);
            where.push(`(u.code ILIKE $${params.length} OR u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
        }
        if (filters.status) {
            where.push(USER_STATUS_SQL[filters.status]);
        }
        if (filters.tag) {
            params.push(filters.tag);
            where.push(`EXISTS (SELECT 1 FROM account_tags t WHERE t.user_id = u.id AND t.tag = $${params.length})`);
        }
        const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const orderBy = sort === "lastLogin" ? "u.last_login_date DESC NULLS LAST, u.id DESC" : sort === "name" ? "LOWER(u.name), u.id" : "u.id DESC";

        const total = await this.db.query(`SELECT COUNT(*)::int AS total FROM users u ${clause}`, params);
        params.push(limit, offset);
        const rows = await this.db.query(
            `SELECT u.id, u.code, u.name, u.email, u.disabled, u.disabled_reason AS "disabledReason", u.email_verified AS "emailVerified",
                    u.totp_enabled AS "totpEnabled", (u.oidc_sub IS NOT NULL) AS sso, u.created_date AS "createdDate",
                    u.last_login_date AS "lastLoginDate", u.last_activity_date AS "lastActivityDate",
                    (SELECT COUNT(*)::int FROM vault_users vu WHERE vu.user_id = u.id AND vu.status = 1) AS "vaultCount",
                    (SELECT d.execute_after FROM scheduled_deletions d WHERE d.entity_type = 'user' AND d.entity_id = u.id
                        AND d.cancelled_at IS NULL AND d.executed_at IS NULL) AS "deletionScheduledFor",
                    COALESCE((SELECT ARRAY_AGG(t.tag ORDER BY t.tag) FROM account_tags t WHERE t.user_id = u.id), '{}') AS tags,
                    (SELECT COUNT(*)::int FROM account_notes n WHERE n.user_id = u.id) AS "noteCount"
               FROM users u ${clause}
              ORDER BY ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        return {rows: rows.rows, total: total.rows[0].total};
    }

    /**
     * @param id User id.
     * @returns The account row, or null.
     */
    public async findUser(id: number): Promise<UserListRow | null> {
        const {rows} = await this.listUsersById(id);
        return rows[0] ?? null;
    }

    private listUsersById(id: number): Promise<{rows: UserListRow[]}> {
        return this.db.query(
            `SELECT u.id, u.code, u.name, u.email, u.disabled, u.disabled_reason AS "disabledReason", u.email_verified AS "emailVerified",
                    u.totp_enabled AS "totpEnabled", (u.oidc_sub IS NOT NULL) AS sso, u.created_date AS "createdDate",
                    u.last_login_date AS "lastLoginDate", u.last_activity_date AS "lastActivityDate",
                    (SELECT COUNT(*)::int FROM vault_users vu WHERE vu.user_id = u.id AND vu.status = 1) AS "vaultCount",
                    (SELECT d.execute_after FROM scheduled_deletions d WHERE d.entity_type = 'user' AND d.entity_id = u.id
                        AND d.cancelled_at IS NULL AND d.executed_at IS NULL) AS "deletionScheduledFor",
                    COALESCE((SELECT ARRAY_AGG(t.tag ORDER BY t.tag) FROM account_tags t WHERE t.user_id = u.id), '{}') AS tags,
                    (SELECT COUNT(*)::int FROM account_notes n WHERE n.user_id = u.id) AS "noteCount"
               FROM users u WHERE u.id = $1`,
            [id]
        );
    }

    /**
     * @param userId User id.
     * @returns The vaults the user belongs to (names only, no content).
     */
    public async userMemberships(userId: number): Promise<UserMembership[]> {
        const result = await this.db.query(
            `SELECT v.id AS "vaultId", v.name AS "vaultName", r.name AS role, vu.status, (v.suspended_at IS NOT NULL) AS suspended
               FROM vault_users vu JOIN vault v ON v.id = vu.vault_id JOIN vault_roles r ON r.code = vu.role
              WHERE vu.user_id = $1 ORDER BY v.id`,
            [userId]
        );
        return result.rows;
    }

    /**
     * @param userId User id.
     * @returns Number of live sessions.
     */
    public async userSessionCount(userId: number): Promise<number> {
        const result = await this.db.query(
            "SELECT COUNT(*)::int AS total FROM user_sessions WHERE user_id = $1 AND revoked_date IS NULL AND last_seen_date > NOW() - INTERVAL '30 days'",
            [userId]
        );
        return result.rows[0].total;
    }

    /**
     * Disables or enables an account. Disabling also ends its sessions.
     * @param userId User id.
     * @param disabled New state.
     * @param reason Why it is disabled (null when enabling).
     * @param db Pool or transaction client.
     * @returns Whether the user exists.
     */
    public async setUserDisabled(userId: number, disabled: boolean, reason: string | null, db: Pool | PoolClient = this.db): Promise<boolean> {
        const result = await db.query(
            `UPDATE users SET disabled = $2, disabled_reason = $3, token_version = token_version + CASE WHEN $2 THEN 1 ELSE 0 END WHERE id = $1`,
            [userId, disabled, disabled ? reason : null]
        );
        if (disabled) {
            await db.query("UPDATE user_sessions SET revoked_date = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_date IS NULL", [userId]);
        }
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Ends every session of an account (token_version bump plus revoking the session rows).
     * @param userId User id.
     * @returns Whether the user exists.
     */
    public async forceLogout(userId: number): Promise<boolean> {
        const result = await this.db.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [userId]);
        await this.db.query("UPDATE user_sessions SET revoked_date = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_date IS NULL", [userId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Removes an account's two-factor setup (lost authenticator) and ends its sessions.
     * @param userId User id.
     * @returns Whether the user exists.
     */
    public async resetUserTwoFactor(userId: number): Promise<boolean> {
        const result = await this.db.query(
            "UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_last_used_step = NULL, token_version = token_version + 1 WHERE id = $1",
            [userId]
        );
        await this.db.query("DELETE FROM user_backup_codes WHERE user_id = $1", [userId]);
        await this.db.query("UPDATE user_sessions SET revoked_date = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_date IS NULL", [userId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * @param filters Search text and status filter.
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of vaults (metadata and sizes only) and the total.
     */
    public async listVaults(filters: {search?: string; status?: "suspended" | "active" | "pending_deletion"}, limit: number, offset: number): Promise<{rows: VaultListRow[]; total: number}> {
        const params: unknown[] = [];
        const where: string[] = [];
        if (filters.search) {
            params.push(`%${filters.search.replace(/[%_\\]/g, "\\$&")}%`);
            where.push(`v.name ILIKE $${params.length}`);
        }
        if (filters.status === "suspended") where.push("v.suspended_at IS NOT NULL");
        if (filters.status === "active") where.push("v.suspended_at IS NULL");
        if (filters.status === "pending_deletion") where.push("v.suspended_reason = 'pending_deletion'");
        const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

        const total = await this.db.query(`SELECT COUNT(*)::int AS total FROM vault v ${clause}`, params);
        params.push(limit, offset);
        const rows = await this.db.query(
            `${this.vaultSelect()} ${clause} ORDER BY v.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        return {rows: rows.rows, total: total.rows[0].total};
    }

    /**
     * @param id Vault id.
     * @returns The vault row, or null.
     */
    public async findVault(id: number): Promise<VaultListRow | null> {
        const result = await this.db.query(`${this.vaultSelect()} WHERE v.id = $1`, [id]);
        return result.rows[0] ?? null;
    }

    private vaultSelect(): string {
        return `SELECT v.id, v.name, v.description, v.date_created AS "createdDate", v.loans_enabled AS "loansEnabled",
                       v.suspended_at AS "suspendedAt", v.suspended_reason AS "suspendedReason",
                       v.plan_id AS "planId", p.name AS "planName",
                       (SELECT COUNT(*)::int FROM vault_users vu WHERE vu.vault_id = v.id AND vu.status = 1) AS "memberCount",
                       COALESCE((SELECT ARRAY_AGG(u.code ORDER BY u.code) FROM vault_users vu JOIN users u ON u.id = vu.user_id
                                  WHERE vu.vault_id = v.id AND vu.status = 1 AND vu.role = 1), '{}') AS admins,
                       (SELECT COUNT(*)::int FROM books b WHERE b.vault_id = v.id) AS "bookCount",
                       (SELECT COUNT(*)::int FROM book_stocks s WHERE s.vault_id = v.id) AS "stockCount",
                       (${VAULT_STORAGE_SQL})::bigint AS "storageBytes",
                       (SELECT d.execute_after FROM scheduled_deletions d WHERE d.entity_type = 'vault' AND d.entity_id = v.id
                           AND d.cancelled_at IS NULL AND d.executed_at IS NULL) AS "deletionScheduledFor"
                  FROM vault v LEFT JOIN plans p ON p.id = v.plan_id`;
    }

    /**
     * @param vaultId Vault id.
     * @returns The members of a vault (identity and role only).
     */
    public async vaultMembers(vaultId: number): Promise<VaultMember[]> {
        const result = await this.db.query(
            `SELECT u.id AS "userId", u.code, u.name, r.name AS role, vu.status
               FROM vault_users vu JOIN users u ON u.id = vu.user_id JOIN vault_roles r ON r.code = vu.role
              WHERE vu.vault_id = $1 ORDER BY r.rank DESC, u.code`,
            [vaultId]
        );
        return result.rows;
    }

    /**
     * Suspends or restores a vault: while suspended its members can't open it.
     * @param vaultId Vault id.
     * @param suspended New state.
     * @param reason Why (null when restoring).
     * @param db Pool or transaction client.
     * @returns Whether the vault exists.
     */
    public async setVaultSuspended(vaultId: number, suspended: boolean, reason: string | null, db: Pool | PoolClient = this.db): Promise<boolean> {
        const result = await db.query(
            "UPDATE vault SET suspended_at = $2, suspended_reason = $3 WHERE id = $1",
            [vaultId, suspended ? new Date() : null, suspended ? reason : null]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * @param vaultId Vault id.
     * @param planId Plan id, or null for "default plan".
     * @returns Whether the vault exists.
     */
    public async setVaultPlan(vaultId: number, planId: number | null): Promise<boolean> {
        const result = await this.db.query("UPDATE vault SET plan_id = $2 WHERE id = $1", [vaultId, planId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * @param filters Optional filters.
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of the regular users' activity log, newest first.
     */
    public async listActivity(filters: {action?: string; actorId?: number; ip?: string}, limit: number, offset: number): Promise<{rows: {id: number; actorId: number | null; actorCode: string | null; action: string; metadata: Record<string, unknown>; createdDate: Date}[]; total: number}> {
        const params: unknown[] = [];
        const where: string[] = [];
        if (filters.action) {
            params.push(filters.action);
            where.push(`a.action = $${params.length}`);
        }
        if (filters.actorId !== undefined) {
            params.push(filters.actorId);
            where.push(`a.actor_id = $${params.length}`);
        }
        if (filters.ip) {
            params.push(filters.ip);
            where.push(`a.metadata->>'ip' = $${params.length}`);
        }
        const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const total = await this.db.query(`SELECT COUNT(*)::int AS total FROM activity_log a ${clause}`, params);
        params.push(limit, offset);
        const rows = await this.db.query(
            `SELECT a.id, a.actor_id AS "actorId", u.code AS "actorCode", a.action, a.metadata, a.created_date AS "createdDate"
               FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id ${clause}
              ORDER BY a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        return {rows: rows.rows, total: total.rows[0].total};
    }
}
