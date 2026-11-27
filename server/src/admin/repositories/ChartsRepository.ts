/** Aggregates behind the charts of the overview page. Metadata only: counts, sizes and names of vaults. */
import {Pool} from "pg";
import {VAULT_STORAGE_SQL} from "./PlatformRepository";

export interface DayCount {
    day: string;
    count: number;
}

export interface ChartsData {
    days: number;
    accountStatus: {active: number; pending: number; disabled: number; unverified: number};
    plans: {name: string; vaults: number}[];
    topByStorage: {id: number; name: string; books: number; bytes: number}[];
    topByBooks: {id: number; name: string; books: number; bytes: number}[];
    growth: {day: string; added: number; total: number}[];
    signups: DayCount[];
    logins: DayCount[];
    failedLogins: {day: string; users: number; admins: number}[];
    emails: {day: string; sent: number; failed: number}[];
    securityByType: {type: string; total: number}[];
    quota: {id: number; name: string; plan: string; percent: number; limiting: string}[];
}

export const CHART_PERIODS = [7, 30, 90];

/** Queries for the overview charts. */
export class ChartsRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /** One row per day of the period (days without data as 0), oldest first. */
    private async perDay(days: number, sql: string, columns: string[]): Promise<any[]> {
        const select = columns.map((c) => `COALESCE(x."${c}", 0)::int AS "${c}"`).join(", ");
        const result = await this.db.query(
            `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, ${select}
               FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, '1 day') AS d(day)
               LEFT JOIN (${sql}) x ON x.day = d.day::date ORDER BY d.day`, [days]);
        return result.rows;
    }

    /**
     * @param days Length of the period (7, 30 or 90).
     * @returns Everything the overview charts need.
     */
    public async charts(days: number): Promise<ChartsData> {
        const since = `CURRENT_DATE - ($1::int - 1)`;
        const status = (await this.db.query(
            `SELECT COUNT(*) FILTER (WHERE disabled AND disabled_reason = 'pending_approval')::int AS pending,
                    COUNT(*) FILTER (WHERE disabled AND COALESCE(disabled_reason, '') <> 'pending_approval')::int AS disabled,
                    COUNT(*) FILTER (WHERE NOT disabled AND email_verified = FALSE)::int AS unverified,
                    COUNT(*) FILTER (WHERE NOT disabled AND email_verified)::int AS active
               FROM users`)).rows[0];
        const plans = (await this.db.query(
            `SELECT COALESCE(p.name, 'No plan') AS name, COUNT(*)::int AS vaults
               FROM vault v LEFT JOIN plans p ON p.id = COALESCE(v.plan_id, (SELECT id FROM plans WHERE is_default))
              GROUP BY 1 ORDER BY 2 DESC, 1`)).rows;
        const vaultCols = `v.id, v.name, (SELECT COUNT(*)::int FROM books b WHERE b.vault_id = v.id) AS books, (${VAULT_STORAGE_SQL})::bigint AS bytes`;
        const toNumbers = (rows: any[]) => rows.map((r) => ({...r, bytes: Number(r.bytes)}));
        const topByStorage = toNumbers((await this.db.query(`SELECT * FROM (SELECT ${vaultCols} FROM vault v) t WHERE bytes > 0 ORDER BY bytes DESC LIMIT 8`)).rows);
        const topByBooks = toNumbers((await this.db.query(`SELECT * FROM (SELECT ${vaultCols} FROM vault v) t WHERE books > 0 ORDER BY books DESC LIMIT 8`)).rows);

        const added = await this.perDay(days, `SELECT date_created::date AS day, COUNT(*) AS added FROM books WHERE date_created >= ${since} GROUP BY 1`, ["added"]);
        let running = (await this.db.query(`SELECT COUNT(*)::int AS n FROM books WHERE date_created < ${since}`, [days])).rows[0].n;
        const growth = added.map((row) => ({day: row.day, added: row.added, total: (running += row.added)}));

        const signups = (await this.perDay(days, `SELECT created_date::date AS day, COUNT(*) AS count FROM users WHERE created_date >= ${since} GROUP BY 1`, ["count"])).map((r) => ({day: r.day, count: r.count}));
        const logins = (await this.perDay(days, `SELECT created_date::date AS day, COUNT(*) AS count FROM activity_log WHERE action = 'login' AND created_date >= ${since} GROUP BY 1`, ["count"])).map((r) => ({day: r.day, count: r.count}));
        const failedLogins = await this.perDay(days,
            `SELECT bucket::date AS day, SUM(count) FILTER (WHERE type IN ('login_failed', 'login_locked')) AS users, SUM(count) FILTER (WHERE type = 'admin_login_failed') AS admins
               FROM security_events WHERE bucket >= ${since} GROUP BY 1`, ["users", "admins"]);
        const emails = await this.perDay(days,
            `SELECT created_date::date AS day, COUNT(*) FILTER (WHERE status = 'sent') AS sent, COUNT(*) FILTER (WHERE status = 'failed') AS failed
               FROM mail_log WHERE created_date >= ${since} GROUP BY 1`, ["sent", "failed"]);
        const securityByType = (await this.db.query(
            `SELECT type, SUM(count)::int AS total FROM security_events WHERE bucket >= ${since} GROUP BY type ORDER BY total DESC`, [days])).rows;

        const quota = (await this.db.query(
            `SELECT id, name, plan, GREATEST(b, s, m)::int AS percent,
                    CASE WHEN b >= s AND b >= m THEN 'books' WHEN s >= m THEN 'storage' ELSE 'members' END AS limiting
               FROM (
                SELECT v.id, v.name, p.name AS plan,
                       COALESCE(100.0 * (SELECT COUNT(*) FROM books b WHERE b.vault_id = v.id) / NULLIF(p.max_books, 0), 0) AS b,
                       COALESCE(100.0 * (${VAULT_STORAGE_SQL}) / NULLIF(p.max_storage_mb::numeric * 1048576, 0), 0) AS s,
                       COALESCE(100.0 * (SELECT COUNT(*) FROM vault_users vu WHERE vu.vault_id = v.id AND vu.status = 1) / NULLIF(p.max_members, 0), 0) AS m
                  FROM vault v JOIN plans p ON p.id = COALESCE(v.plan_id, (SELECT id FROM plans WHERE is_default))
               ) q WHERE GREATEST(b, s, m) > 0 ORDER BY GREATEST(b, s, m) DESC LIMIT 8`)).rows;

        return {days, accountStatus: status, plans, topByStorage, topByBooks, growth, signups, logins, failedLogins, emails, securityByType, quota};
    }
}
