/** Data access for `scheduled_deletions` (account/vault deletions waiting out their grace period). */
import {Pool, PoolClient} from "pg";

export type DeletionEntity = "user" | "vault";

export interface DeletionRow {
    id: number;
    entityType: DeletionEntity;
    entityId: number;
    entityLabel: string;
    requestedBy: string | null;
    requestedAt: Date;
    executeAfter: Date;
    cancelledAt: Date | null;
    executedAt: Date | null;
    lastError: string | null;
}

const COLUMNS = `d.id, d.entity_type AS "entityType", d.entity_id AS "entityId", d.entity_label AS "entityLabel",
                 a.email AS "requestedBy", d.requested_at AS "requestedAt", d.execute_after AS "executeAfter",
                 d.cancelled_at AS "cancelledAt", d.executed_at AS "executedAt", d.last_error AS "lastError"`;

/** Data access for scheduled deletions. */
export class DeletionRepository {
    /**
     * @param db Pool, or a transaction's client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Schedules a deletion.
     * @param entityType What is deleted.
     * @param entityId Its id.
     * @param label Name kept for the record once the entity is gone.
     * @param adminId Admin requesting it.
     * @param executeAfter When it may be carried out.
     * @returns The new deletion's id.
     * @throws The raw pg error (23505) when one is already scheduled for the entity.
     */
    public async schedule(entityType: DeletionEntity, entityId: number, label: string, adminId: number, executeAfter: Date): Promise<number> {
        const result = await this.db.query(
            `INSERT INTO scheduled_deletions (entity_type, entity_id, entity_label, requested_by, execute_after)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [entityType, entityId, label.slice(0, 150), adminId, executeAfter]
        );
        return result.rows[0].id;
    }

    /**
     * @param id Deletion id.
     * @returns The deletion, or null.
     */
    public async find(id: number): Promise<DeletionRow | null> {
        const result = await this.db.query(`SELECT ${COLUMNS} FROM scheduled_deletions d LEFT JOIN admin_users a ON a.id = d.requested_by WHERE d.id = $1`, [id]);
        return result.rows[0] ?? null;
    }

    /**
     * @param openOnly Only deletions still waiting (not cancelled or executed).
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of deletions, newest first.
     */
    public async list(openOnly: boolean, limit: number, offset: number): Promise<{rows: DeletionRow[]; total: number}> {
        const clause = openOnly ? "WHERE d.cancelled_at IS NULL AND d.executed_at IS NULL" : "";
        const total = await this.db.query(`SELECT COUNT(*)::int AS total FROM scheduled_deletions d ${clause}`);
        const rows = await this.db.query(
            `SELECT ${COLUMNS} FROM scheduled_deletions d LEFT JOIN admin_users a ON a.id = d.requested_by ${clause}
              ORDER BY d.id DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return {rows: rows.rows, total: total.rows[0].total};
    }

    /**
     * @param entityType Entity kind.
     * @param entityId Entity id.
     * @returns The open deletion for the entity, or null.
     */
    public async findOpen(entityType: DeletionEntity, entityId: number): Promise<DeletionRow | null> {
        const result = await this.db.query(
            `SELECT ${COLUMNS} FROM scheduled_deletions d LEFT JOIN admin_users a ON a.id = d.requested_by
              WHERE d.entity_type = $1 AND d.entity_id = $2 AND d.cancelled_at IS NULL AND d.executed_at IS NULL`,
            [entityType, entityId]
        );
        return result.rows[0] ?? null;
    }

    /** @returns Open deletions whose grace period is over. */
    public async due(): Promise<DeletionRow[]> {
        const result = await this.db.query(
            `SELECT ${COLUMNS} FROM scheduled_deletions d LEFT JOIN admin_users a ON a.id = d.requested_by
              WHERE d.cancelled_at IS NULL AND d.executed_at IS NULL AND d.execute_after <= CURRENT_TIMESTAMP ORDER BY d.id`
        );
        return result.rows;
    }

    /** @param id Deletion id. */
    public async markCancelled(id: number): Promise<void> {
        await this.db.query("UPDATE scheduled_deletions SET cancelled_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);
    }

    /** @param id Deletion id. */
    public async markExecuted(id: number): Promise<void> {
        await this.db.query("UPDATE scheduled_deletions SET executed_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = $1", [id]);
    }

    /**
     * @param id Deletion id.
     * @param message Why it could not be carried out.
     */
    public async markFailed(id: number, message: string): Promise<void> {
        await this.db.query("UPDATE scheduled_deletions SET last_error = $2 WHERE id = $1", [id, message.slice(0, 500)]);
    }
}
