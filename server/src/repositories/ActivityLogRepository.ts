/**
 * Bookkeeping for `activity_log` - a generic, append-only security/audit
 * log. Only auth events are written today (see AuthService.ts and
 * UserService.ts); `entityType`/`entityId` exist so future data-change
 * logging (books, loans, ...) can reuse this same table instead of
 * growing a new one per feature.
 */
import {Pool, PoolClient} from "pg";

/**
 * Auth events currently written - keep in sync with GET /user/activity's
 * filter (which reads `Object.values(ActivityAction)` rather than
 * duplicating this list, so the two can't drift). The `action` DB column
 * itself is a plain VARCHAR with no CHECK constraint.
 */
export enum ActivityAction {
    LOGIN = "login",
    LOGIN_FAILED = "login_failed",
    LOGOUT = "logout",
    PASSWORD_CHANGED = "password_changed",
}

export interface RecordActivityOptions {
    entityType?: string | null;
    entityId?: number | null;
    metadata?: Record<string, unknown>;
}

/** Data access for the `activity_log` audit trail. */
export class ActivityLogRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Append one row to `activity_log`.
     * @param actorId The user the action is attributed to, or `null` when
     *                there isn't one yet (e.g. a failed login for a username
     *                that doesn't match any account - see `options.metadata` instead).
     * @param action Which event this is, e.g. `ActivityAction.LOGIN`.
     * @param options Optional entity linkage and metadata.
     */
    public async recordActivity(
        actorId: number | null,
        action: ActivityAction,
        options: RecordActivityOptions = {}
    ): Promise<void> {
        await this.db.query(
            `INSERT INTO activity_log (actor_id, action, entity_type, entity_id, metadata)
             VALUES ($1, $2, $3, $4, $5)`,
            [actorId, action, options.entityType ?? null, options.entityId ?? null, options.metadata ?? {}]
        );
    }
}
