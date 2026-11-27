/** Data access for `admin_audit_log`, which the database keeps append-only. */
import {Pool} from "pg";

export interface AuditEntry {
    id: number;
    adminId: number | null;
    adminEmail: string | null;
    action: string;
    entityType: string | null;
    entityId: number | null;
    entityLabel: string | null;
    metadata: Record<string, unknown>;
    ipAddress: string | null;
    createdDate: Date;
}

/** Data access for the admin audit trail. */
export class AdminAuditRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /**
     * Appends one entry.
     * @param entry What happened and who did it.
     */
    public async append(entry: {adminId: number | null; adminEmail: string | null; action: string; entityType?: string | null; entityId?: number | null; entityLabel?: string | null; metadata?: Record<string, unknown>; ip?: string | null}): Promise<void> {
        await this.db.query(
            `INSERT INTO admin_audit_log (admin_id, admin_email, action, entity_type, entity_id, entity_label, metadata, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [entry.adminId, entry.adminEmail, entry.action, entry.entityType ?? null, entry.entityId ?? null,
                entry.entityLabel?.slice(0, 150) ?? null, entry.metadata ?? {}, entry.ip ?? null]
        );
    }

    /**
     * @param filters Optional filters.
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of entries, newest first, and the total.
     */
    public async list(filters: {action?: string; adminId?: number; entityType?: string}, limit: number, offset: number): Promise<{rows: AuditEntry[]; total: number}> {
        const params: unknown[] = [];
        const where: string[] = [];
        if (filters.action) {
            params.push(`${filters.action}%`);
            where.push(`action LIKE $${params.length}`);
        }
        if (filters.adminId !== undefined) {
            params.push(filters.adminId);
            where.push(`admin_id = $${params.length}`);
        }
        if (filters.entityType) {
            params.push(filters.entityType);
            where.push(`entity_type = $${params.length}`);
        }
        const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const total = await this.db.query(`SELECT COUNT(*)::int AS total FROM admin_audit_log ${clause}`, params);
        params.push(limit, offset);
        const rows = await this.db.query(
            `SELECT id, admin_id AS "adminId", admin_email AS "adminEmail", action, entity_type AS "entityType", entity_id AS "entityId",
                    entity_label AS "entityLabel", metadata, ip_address AS "ipAddress", created_date AS "createdDate"
               FROM admin_audit_log ${clause} ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        return {rows: rows.rows, total: total.rows[0].total};
    }
}
