/** Data access for `mail_log`, the record of emails the server sent (recipient, subject, outcome - never the body). */
import {Pool} from "pg";

export interface MailLogEntry {
    id: number;
    toAddress: string;
    subject: string;
    status: "sent" | "failed";
    error: string | null;
    createdDate: Date;
}

/** Data access for the sent-mail log. */
export class MailLogRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /**
     * @param to Recipient.
     * @param subject Subject line.
     * @param error Why delivery failed, or null when it was accepted.
     */
    public async add(to: string, subject: string, error: string | null): Promise<void> {
        await this.db.query(
            "INSERT INTO mail_log (to_address, subject, status, error) VALUES ($1, $2, $3, $4)",
            [to.slice(0, 255), subject.slice(0, 255), error === null ? "sent" : "failed", error?.slice(0, 500) ?? null]
        );
    }

    /**
     * @param filters Optional status and free-text (recipient or subject) filters.
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page, newest first, and the total.
     */
    public async list(filters: {status?: string; search?: string}, limit: number, offset: number): Promise<{rows: MailLogEntry[]; total: number}> {
        const params: unknown[] = [];
        const where: string[] = [];
        if (filters.status === "sent" || filters.status === "failed") {
            params.push(filters.status);
            where.push(`status = $${params.length}`);
        }
        if (filters.search) {
            params.push(`%${filters.search.replace(/[%_\\]/g, "\\$&")}%`);
            where.push(`(to_address ILIKE $${params.length} OR subject ILIKE $${params.length})`);
        }
        const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const total = await this.db.query(`SELECT COUNT(*)::int AS total FROM mail_log ${clause}`, params);
        params.push(limit, offset);
        const rows = await this.db.query(
            `SELECT id, to_address AS "toAddress", subject, status, error, created_date AS "createdDate"
               FROM mail_log ${clause} ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        return {rows: rows.rows, total: total.rows[0].total};
    }

    /**
     * Removes old entries.
     * @param before Entries older than this go.
     */
    public async purge(before: Date): Promise<void> {
        await this.db.query("DELETE FROM mail_log WHERE created_date < $1", [before]);
    }
}
