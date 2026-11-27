/**
 * How long each kind of record is kept, and the purge that enforces it.
 *
 * GDPR asks that personal data isn't kept longer than needed (art. 5(1)(e)), and the person in charge decides how long
 * is needed. Sign-in addresses, email addresses and admin actions are personal data, so each log has its own period
 * here (days; 0 keeps it forever). The settings are edited on the Data retention page, like any other portal setting,
 * and the hourly "Purge old records" job deletes what is older.
 *
 * The audit trail is special: the database refuses to change or delete it. Only this job may remove an entry, only
 * one older than 90 days, and only inside a transaction that says so (see `admin_audit_log_append_only`).
 */
import {Pool} from "pg";
import {appService} from "../../AppService";
import {findSetting} from "./settingsCatalog";

export interface RetentionItem {
    id: string;
    key: string;
    label: string;
    description: string;
    table: string;
    column: string;
    /** Holds personal data (addresses, emails, who did what). */
    personal: boolean;
    /** Shortest period allowed besides 0 (keep forever). */
    minDays: number;
}

export const RETENTION_ITEMS: RetentionItem[] = [
    {id: "activity_log", key: "RETENTION_ACTIVITY_LOG_DAYS", label: "Sign-in and activity log", description: "When people signed in and from which address, and other recorded actions. Feeds the login map and the last-activity of an account.", table: "activity_log", column: "created_date", personal: true, minDays: 1},
    {id: "security_events", key: "RETENTION_SECURITY_EVENTS_DAYS", label: "Security events", description: "Failed sign-ins, rate limits and blocked requests, counted per address and minute.", table: "security_events", column: "bucket", personal: true, minDays: 1},
    {id: "mail_log", key: "RETENTION_MAIL_LOG_DAYS", label: "Emails sent", description: "Recipient, subject and delivery result of each email the app sent (never the text).", table: "mail_log", column: "created_date", personal: true, minDays: 1},
    {id: "admin_notifications", key: "RETENTION_NOTIFICATIONS_DAYS", label: "Admin notifications", description: "The history of the alerts emailed to admins.", table: "admin_notifications", column: "created_date", personal: false, minDays: 1},
    {id: "webhook_deliveries", key: "RETENTION_WEBHOOK_DELIVERIES_DAYS", label: "Webhook deliveries", description: "The log of what each webhook sent and whether it arrived.", table: "webhook_deliveries", column: "created_date", personal: false, minDays: 1},
    {id: "job_runs", key: "RETENTION_JOB_RUNS_DAYS", label: "Background job history", description: "When each background job ran and what it did.", table: "job_runs", column: "started_at", personal: false, minDays: 1},
    {id: "admin_audit_log", key: "RETENTION_AUDIT_DAYS", label: "Audit trail", description: "What admins did in this console. Kept as evidence: the database allows removing an entry only after 90 days, and only through this setting.", table: "admin_audit_log", column: "created_date", personal: true, minDays: 90},
];

/** The shortest audit retention the database accepts. */
export const AUDIT_FLOOR_DAYS = 90;

export interface RetentionRow extends RetentionItem {
    days: number;
    defaultDays: number;
    rows: number;
    oldest: string | null;
    /** Rows already older than the period (the next purge removes them). */
    overdue: number;
}

/** Applies the retention settings. */
export class RetentionService {
    /**
     * @param pool Database pool.
     */
    public constructor(private readonly pool: Pool) {
    }

    /** @param item Retention item. @returns The days it is kept (0 = forever). */
    public days(item: RetentionItem): number {
        const raw = appService.getSettings().get(item.key);
        const value = Number(raw === undefined || raw === "" ? findSetting(item.key)?.defaultValue : raw);
        const days = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
        return days > 0 && days < item.minDays ? item.minDays : days;
    }

    /** @returns Every item with its period, size and how much is already past it. */
    public async overview(): Promise<RetentionRow[]> {
        const rows: RetentionRow[] = [];
        for (const item of RETENTION_ITEMS) {
            const days = this.days(item);
            const stats = (await this.pool.query(
                `SELECT COUNT(*)::int AS rows, MIN(${item.column}) AS oldest,
                        COUNT(*) FILTER (WHERE $1::int > 0 AND ${item.column} < CURRENT_TIMESTAMP - make_interval(days => $1::int))::int AS overdue
                   FROM ${item.table}`, [days])).rows[0];
            rows.push({...item, days, defaultDays: Number(findSetting(item.key)?.defaultValue ?? 0), rows: stats.rows, oldest: stats.oldest, overdue: stats.overdue});
        }
        return rows;
    }

    /**
     * Deletes every record older than its period.
     * @returns How many were removed from each table.
     */
    public async purge(): Promise<Record<string, number>> {
        const removed: Record<string, number> = {};
        for (const item of RETENTION_ITEMS) {
            const days = this.days(item);
            if (days === 0) {
                continue;
            }
            const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            if (item.id === "admin_audit_log") {
                const client = await this.pool.connect();
                try {
                    await client.query("BEGIN");
                    await client.query("SET LOCAL vaultisse.audit_retention = 'on'");
                    const result = await client.query(`DELETE FROM ${item.table} WHERE ${item.column} < $1`, [cutoff]);
                    await client.query("COMMIT");
                    removed[item.id] = result.rowCount ?? 0;
                } catch (error) {
                    await client.query("ROLLBACK").catch(() => undefined);
                    throw error;
                } finally {
                    client.release();
                }
                if (removed[item.id] > 0) {
                    await appService.getAdminAudit().recordAs("retention.purge", {id: null, email: null}, null, {entityType: "audit", metadata: {removed: removed[item.id], olderThanDays: days}});
                }
            } else {
                const result = await this.pool.query(`DELETE FROM ${item.table} WHERE ${item.column} < $1`, [cutoff]);
                removed[item.id] = result.rowCount ?? 0;
            }
        }
        return removed;
    }
}
