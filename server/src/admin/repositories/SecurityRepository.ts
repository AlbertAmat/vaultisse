/** Data access for `security_events`, `blocked_ips` and the cross-tenant session/lockout views of the security page. */
import {Pool} from "pg";

export type SecurityEventType = "rate_limited" | "login_failed" | "login_locked" | "admin_login_failed" | "blocked_ip_hit";

export interface SecurityEventRow {
    type: SecurityEventType;
    ipAddress: string;
    bucket: Date;
    count: number;
    userAgent: string | null;
    lastPath: string | null;
    detail: string | null;
}

export interface BlockedIpRow {
    ipAddress: string;
    reason: string | null;
    blockedBy: string | null;
    createdDate: Date;
    expiresAt: Date | null;
}

/** Data access for the security page. */
export class SecurityRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /**
     * Adds counts to the per-minute rows, creating them when needed.
     * @param rows Aggregated events to merge in.
     */
    public async addEvents(rows: {type: SecurityEventType; ip: string; bucket: Date; count: number; userAgent: string | null; path: string | null; detail: string | null}[]): Promise<void> {
        for (const row of rows) {
            await this.db.query(
                `INSERT INTO security_events (type, ip_address, bucket, count, user_agent, last_path, detail)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (type, ip_address, bucket) DO UPDATE
                    SET count = security_events.count + EXCLUDED.count,
                        last_path = COALESCE(EXCLUDED.last_path, security_events.last_path)`,
                [row.type, row.ip, row.bucket, row.count, row.userAgent?.slice(0, 300) ?? null, row.path?.slice(0, 200) ?? null, row.detail?.slice(0, 200) ?? null]
            );
        }
    }

    /**
     * @param since Start of the window.
     * @returns Total events per type since `since`.
     */
    public async countByType(since: Date): Promise<{type: SecurityEventType; total: number; ips: number}[]> {
        const result = await this.db.query(
            `SELECT type, SUM(count)::int AS total, COUNT(DISTINCT ip_address)::int AS ips
               FROM security_events WHERE bucket >= $1 GROUP BY type ORDER BY total DESC`,
            [since]
        );
        return result.rows;
    }

    /**
     * @param filters Optional type/ip filters.
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of events, newest first, and the total.
     */
    public async listEvents(filters: {type?: string; ip?: string}, limit: number, offset: number): Promise<{rows: SecurityEventRow[]; total: number}> {
        const params: unknown[] = [];
        const where: string[] = [];
        if (filters.type) {
            params.push(filters.type);
            where.push(`type = $${params.length}`);
        }
        if (filters.ip) {
            params.push(filters.ip);
            where.push(`ip_address = $${params.length}`);
        }
        const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const total = await this.db.query(`SELECT COUNT(*)::int AS total FROM security_events ${clause}`, params);
        params.push(limit, offset);
        const rows = await this.db.query(
            `SELECT type, ip_address AS "ipAddress", bucket, count, user_agent AS "userAgent", last_path AS "lastPath", detail
               FROM security_events ${clause}
              ORDER BY bucket DESC, count DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        return {rows: rows.rows, total: total.rows[0].total};
    }

    /**
     * @param since Start of the window.
     * @param limit Number of addresses.
     * @returns The addresses behind most events since `since`.
     */
    public async topIps(since: Date, limit: number): Promise<{ipAddress: string; total: number; types: string[]}[]> {
        const result = await this.db.query(
            `SELECT ip_address AS "ipAddress", SUM(count)::int AS total, ARRAY_AGG(DISTINCT type) AS types
               FROM security_events WHERE bucket >= $1
              GROUP BY ip_address ORDER BY total DESC LIMIT $2`,
            [since, limit]
        );
        return result.rows;
    }

    /**
     * Deletes events older than the retention window.
     * @param before Cut-off.
     * @returns Rows removed.
     */
    public async purgeEvents(before: Date): Promise<number> {
        const result = await this.db.query("DELETE FROM security_events WHERE bucket < $1", [before]);
        return result.rowCount ?? 0;
    }

    /** @returns Every block that hasn't expired. */
    public async listBlockedIps(): Promise<BlockedIpRow[]> {
        const result = await this.db.query(
            `SELECT b.ip_address AS "ipAddress", b.reason, a.email AS "blockedBy", b.created_date AS "createdDate", b.expires_at AS "expiresAt"
               FROM blocked_ips b LEFT JOIN admin_users a ON a.id = b.blocked_by
              WHERE b.expires_at IS NULL OR b.expires_at > CURRENT_TIMESTAMP
              ORDER BY b.created_date DESC`
        );
        return result.rows;
    }

    /**
     * Blocks an address (or refreshes an existing block).
     * @param ip Address.
     * @param reason Free text.
     * @param adminId Admin blocking it.
     * @param expiresAt When the block lapses, or null for no end.
     */
    public async blockIp(ip: string, reason: string | null, adminId: number, expiresAt: Date | null): Promise<void> {
        await this.db.query(
            `INSERT INTO blocked_ips (ip_address, reason, blocked_by, expires_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (ip_address) DO UPDATE
                SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by,
                    expires_at = EXCLUDED.expires_at, created_date = CURRENT_TIMESTAMP`,
            [ip, reason, adminId, expiresAt]
        );
    }

    /**
     * @param ip Address.
     * @returns Whether a block was removed.
     */
    public async unblockIp(ip: string): Promise<boolean> {
        const result = await this.db.query("DELETE FROM blocked_ips WHERE ip_address = $1", [ip]);
        return (result.rowCount ?? 0) > 0;
    }

    /** @returns Addresses currently blocked, for the in-memory cache. */
    public async activeBlockedAddresses(): Promise<string[]> {
        const result = await this.db.query(
            "SELECT ip_address FROM blocked_ips WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP"
        );
        return result.rows.map((row: {ip_address: string}) => row.ip_address);
    }

    /** @returns Accounts that are locked out after failed logins right now. */
    public async listLockouts(): Promise<{userId: number; code: string; email: string; failedLoginCount: number; lockoutUntil: Date | null; totpLockoutUntil: Date | null}[]> {
        const result = await this.db.query(
            `SELECT id AS "userId", code, email, failed_login_count AS "failedLoginCount",
                    lockout_until AS "lockoutUntil", totp_lockout_until AS "totpLockoutUntil"
               FROM users
              WHERE lockout_until > CURRENT_TIMESTAMP OR totp_lockout_until > CURRENT_TIMESTAMP
              ORDER BY GREATEST(lockout_until, totp_lockout_until) DESC`
        );
        return result.rows;
    }

    /**
     * Clears a user's failed-login counters and lockouts.
     * @param userId User id.
     * @returns Whether the user exists.
     */
    public async clearLockout(userId: number): Promise<boolean> {
        const result = await this.db.query(
            `UPDATE users SET failed_login_count = 0, lockout_until = NULL, totp_failed_count = 0, totp_lockout_until = NULL WHERE id = $1`,
            [userId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * @param cutoff Only sessions seen after this time.
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns Active (not revoked) user sessions across all accounts, most recently seen first.
     */
    public async listActiveUserSessions(cutoff: Date, limit: number, offset: number): Promise<{rows: {id: number; userId: number; userCode: string; userAgent: string | null; ipAddress: string | null; createdDate: Date; lastSeenDate: Date}[]; total: number}> {
        const total = await this.db.query(
            "SELECT COUNT(*)::int AS total FROM user_sessions WHERE revoked_date IS NULL AND last_seen_date > $1", [cutoff]
        );
        const rows = await this.db.query(
            `SELECT s.id, s.user_id AS "userId", u.code AS "userCode", s.user_agent AS "userAgent", s.ip_address AS "ipAddress",
                    s.created_date AS "createdDate", s.last_seen_date AS "lastSeenDate"
               FROM user_sessions s JOIN users u ON u.id = s.user_id
              WHERE s.revoked_date IS NULL AND s.last_seen_date > $1
              ORDER BY s.last_seen_date DESC LIMIT $2 OFFSET $3`,
            [cutoff, limit, offset]
        );
        return {rows: rows.rows, total: total.rows[0].total};
    }

    /**
     * @param sessionId Session id.
     * @returns Whether a live session was revoked.
     */
    public async revokeUserSession(sessionId: number): Promise<boolean> {
        const result = await this.db.query(
            "UPDATE user_sessions SET revoked_date = CURRENT_TIMESTAMP WHERE id = $1 AND revoked_date IS NULL", [sessionId]
        );
        return (result.rowCount ?? 0) > 0;
    }
}
