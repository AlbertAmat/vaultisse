/**
 * Data access for the "Admin sign-ins" page: who tried to sign in to the admin console, from where, and whether it worked.
 *
 * The source is the audit trail (`admin_audit_log`), where the console records every attempt:
 *   auth.login          a successful sign-in (after the password AND the authenticator code)
 *   auth.login_failed   a failed attempt; `admin_email` is what was typed, `metadata.stage` says where it failed:
 *                       "password", "second factor", "enrolment code" or "reauthentication"
 * plus the attempts the login rate limiter refused, which are counted in `security_events` (type rate_limited, detail admin-login).
 */
import {Pool} from "pg";

export const SIGN_IN_PERIODS = [1, 7, 30, 90];

export interface SignInSource {
    ip: string;
    failed: number;
    ok: number;
    /** Attempts refused by the login rate limiter before they were even checked. */
    limited: number;
    /** How many different emails were tried from this address (a spray of many is the mark of a bot). */
    emails: number;
    stages: string[];
    firstSeen: Date;
    lastSeen: Date;
}

export interface SignInAttempt {
    id: number;
    at: Date;
    result: "ok" | "failed";
    email: string | null;
    ip: string | null;
    stage: string | null;
}

/** Queries over the admin sign-in history. */
export class AdminSignInsRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /**
     * @param since Start of the window.
     * @param unit Bucket size: an hour for a day-long window, otherwise a day.
     * @returns Successful and failed attempts per bucket, oldest first, empty buckets included.
     */
    public async timeline(since: Date, unit: "hour" | "day"): Promise<{bucket: string; ok: number; failed: number}[]> {
        const result = await this.db.query(
            `SELECT to_char(b.bucket, 'YYYY-MM-DD"T"HH24:00:00') AS bucket, COALESCE(x.ok, 0)::int AS ok, COALESCE(x.failed, 0)::int AS failed
               FROM generate_series(date_trunc($2, $1::timestamptz), date_trunc($2, NOW()), CASE WHEN $2 = 'hour' THEN interval '1 hour' ELSE interval '1 day' END) AS b(bucket)
               LEFT JOIN (
                  SELECT date_trunc($2, created_date) AS bucket, COUNT(*) FILTER (WHERE action = 'auth.login') AS ok, COUNT(*) FILTER (WHERE action = 'auth.login_failed') AS failed
                    FROM admin_audit_log WHERE action IN ('auth.login', 'auth.login_failed') AND created_date >= $1 GROUP BY 1
               ) x ON x.bucket = b.bucket
              ORDER BY b.bucket`, [since, unit]);
        return result.rows;
    }

    /**
     * @param since Start of the window.
     * @returns One row per address that tried to sign in, the most failures first.
     */
    public async sources(since: Date): Promise<SignInSource[]> {
        const result = await this.db.query(
            `SELECT ip_address AS ip,
                    COUNT(*) FILTER (WHERE action = 'auth.login_failed')::int AS failed,
                    COUNT(*) FILTER (WHERE action = 'auth.login')::int AS ok,
                    COUNT(DISTINCT LOWER(admin_email)) FILTER (WHERE action = 'auth.login_failed')::int AS emails,
                    COALESCE(ARRAY_AGG(DISTINCT metadata->>'stage') FILTER (WHERE action = 'auth.login_failed' AND metadata->>'stage' IS NOT NULL), '{}') AS stages,
                    MIN(created_date) AS "firstSeen", MAX(created_date) AS "lastSeen"
               FROM admin_audit_log
              WHERE action IN ('auth.login', 'auth.login_failed') AND created_date >= $1 AND ip_address IS NOT NULL
              GROUP BY ip_address ORDER BY failed DESC, MAX(created_date) DESC LIMIT 300`, [since]);
        const limited = await this.limiterHits(since);
        const rows: SignInSource[] = result.rows.map((row) => ({...row, limited: limited.get(row.ip) ?? 0}));
        // An address the limiter stopped every time has no audit rows at all, but it is exactly the one to see.
        for (const [ip, hits] of limited) {
            if (!rows.some((row) => row.ip === ip)) {
                rows.push({ip, failed: 0, ok: 0, limited: hits, emails: 0, stages: [], firstSeen: since, lastSeen: since});
            }
        }
        return rows;
    }

    /** @param since Start of the window. @returns Attempts the rate limiter refused, per address. */
    public async limiterHits(since: Date): Promise<Map<string, number>> {
        const result = await this.db.query(
            `SELECT ip_address AS ip, SUM(count)::int AS hits FROM security_events
              WHERE type = 'rate_limited' AND detail = 'admin-login' AND bucket >= $1 GROUP BY ip_address`, [since]);
        return new Map(result.rows.map((row: {ip: string; hits: number}) => [row.ip, row.hits]));
    }

    /**
     * @param filters Window, result and address.
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of attempts, newest first, and the total.
     */
    public async attempts(filters: {since: Date; result?: "ok" | "failed"; ip?: string}, limit: number, offset: number): Promise<{rows: SignInAttempt[]; total: number}> {
        const params: unknown[] = [filters.since];
        const where = ["created_date >= $1", filters.result ? `action = '${filters.result === "ok" ? "auth.login" : "auth.login_failed"}'` : "action IN ('auth.login', 'auth.login_failed')"];
        if (filters.ip) {
            params.push(filters.ip);
            where.push(`ip_address = $${params.length}`);
        }
        const clause = `WHERE ${where.join(" AND ")}`;
        const total = await this.db.query(`SELECT COUNT(*)::int AS total FROM admin_audit_log ${clause}`, params);
        params.push(limit, offset);
        const rows = await this.db.query(
            `SELECT id, created_date AS at, CASE WHEN action = 'auth.login' THEN 'ok' ELSE 'failed' END AS result, admin_email AS email, ip_address AS ip, metadata->>'stage' AS stage
               FROM admin_audit_log ${clause} ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return {rows: rows.rows, total: total.rows[0].total};
    }

    /**
     * @param since Start of the window.
     * @returns How many attempts succeeded and failed, and from how many addresses the failures came.
     */
    public async totals(since: Date): Promise<{ok: number; failed: number; failedIps: number}> {
        const result = await this.db.query(
            `SELECT COUNT(*) FILTER (WHERE action = 'auth.login')::int AS ok, COUNT(*) FILTER (WHERE action = 'auth.login_failed')::int AS failed,
                    COUNT(DISTINCT ip_address) FILTER (WHERE action = 'auth.login_failed')::int AS "failedIps"
               FROM admin_audit_log WHERE action IN ('auth.login', 'auth.login_failed') AND created_date >= $1`, [since]);
        return result.rows[0];
    }
}
