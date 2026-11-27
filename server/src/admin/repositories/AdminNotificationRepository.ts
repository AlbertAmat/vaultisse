/** Data access for `admin_notifications`: the record of what the portal emailed its admins. */
import {Pool} from "pg";

export interface AdminNotificationEntry {
    id: number;
    type: string;
    subject: string;
    recipients: number;
    status: "sent" | "failed" | "skipped";
    detail: string | null;
    createdDate: Date;
}

/** Data access for the admin notification history. */
export class AdminNotificationRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /**
     * @param entry What was (not) sent.
     */
    public async add(entry: {type: string; subject: string; recipients: number; status: "sent" | "failed" | "skipped"; detail?: string | null; dedupeKey?: string | null}): Promise<void> {
        await this.db.query(
            `INSERT INTO admin_notifications (type, subject, recipients, status, detail, dedupe_key) VALUES ($1, $2, $3, $4, $5, $6)`,
            [entry.type, entry.subject.slice(0, 200), entry.recipients, entry.status, entry.detail?.slice(0, 500) ?? null, entry.dedupeKey ?? null]
        );
    }

    /**
     * @param dedupeKey Alert identity.
     * @param sinceMs How far back to look.
     * @returns Whether the same alert was already raised within that time.
     */
    public async raisedRecently(dedupeKey: string, sinceMs: number): Promise<boolean> {
        const result = await this.db.query(
            "SELECT 1 FROM admin_notifications WHERE dedupe_key = $1 AND created_date > $2 LIMIT 1",
            [dedupeKey, new Date(Date.now() - sinceMs)]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of the history, newest first, and the total.
     */
    public async list(limit: number, offset: number): Promise<{rows: AdminNotificationEntry[]; total: number}> {
        const total = await this.db.query("SELECT COUNT(*)::int AS total FROM admin_notifications");
        const rows = await this.db.query(
            `SELECT id, type, subject, recipients, status, detail, created_date AS "createdDate"
               FROM admin_notifications ORDER BY id DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return {rows: rows.rows, total: total.rows[0].total};
    }

    /**
     * Removes old entries.
     * @param before Entries older than this go.
     */
    public async purge(before: Date): Promise<void> {
        await this.db.query("DELETE FROM admin_notifications WHERE created_date < $1", [before]);
    }
}
