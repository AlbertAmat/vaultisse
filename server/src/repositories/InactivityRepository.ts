/**
 * Data access for the inactive-account cleanup - see InactivityService.ts.
 * "Last activity" is the latest of: account creation, password/SSO login,
 * any session being used, and OPDS feed use.
 */
import {Pool, PoolClient} from "pg";
import {VaultRoleCode} from "../types/vault";

/** An account that has been idle long enough to be warned or deleted. */
export interface InactiveAccount {
    id: number;
    name: string;
    email: string;
    /** When the current deletion warning was sent; null if none since the last activity. */
    warnedAt: Date | null;
}

/** Data access for the inactive-account cleanup. */
export class InactivityRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Lists accounts idle for at least `idleDays` that are safe to delete.
     *
     * Left out: accounts that can't log in anyway (disabled or unverified);
     * borrowers with copies still on loan, which deletion would mark as
     * available; and the only admin of a vault shared with other people.
     * @param idleDays Minimum days without activity.
     * @param onlyUserId Restrict to one account, to re-check it right before deleting.
     * @returns The matching accounts.
     */
    public async listInactive(idleDays: number, onlyUserId: number | null = null): Promise<InactiveAccount[]> {
        const result = await this.db.query(
            `SELECT u.id, u.name, u.email,
                    CASE WHEN u.deletion_warned_at > a.last_activity THEN u.deletion_warned_at END AS "warnedAt"
               FROM users u
               CROSS JOIN LATERAL (
                   SELECT GREATEST(
                       u.created_date::timestamptz,
                       u.last_login_date::timestamptz,
                       u.last_activity_date,
                       (SELECT MAX(s.last_seen_date) FROM user_sessions s WHERE s.user_id = u.id)
                   ) AS last_activity
               ) a
              WHERE a.last_activity <= NOW() - make_interval(days => $1)
                AND ($2::int IS NULL OR u.id = $2)
                AND u.disabled = FALSE
                AND u.email_verified = TRUE
                AND NOT EXISTS (SELECT 1 FROM book_stocks b WHERE b.member_user_id = u.id AND b.status = 2)
                AND NOT EXISTS (
                    SELECT 1
                      FROM vault_users mine
                     WHERE mine.user_id = u.id
                       AND mine.role = $3
                       AND EXISTS (SELECT 1 FROM vault_users o WHERE o.vault_id = mine.vault_id AND o.user_id <> u.id)
                       AND NOT EXISTS (SELECT 1 FROM vault_users o WHERE o.vault_id = mine.vault_id AND o.user_id <> u.id AND o.role = $3)
                )
              ORDER BY u.id`,
            [idleDays, onlyUserId, VaultRoleCode.ADMIN]
        );
        return result.rows;
    }

    /**
     * Records that the deletion warning was sent.
     * @param userId Warned account.
     */
    public async markWarned(userId: number): Promise<void> {
        await this.db.query(`UPDATE users SET deletion_warned_at = NOW() WHERE id = $1`, [userId]);
    }

    /**
     * Checks whether a warning is at least `noticeDays` old.
     * @param warnedAt When the warning was sent.
     * @param noticeDays Required notice period.
     * @returns Whether the notice period has passed.
     */
    public async noticeElapsed(warnedAt: Date, noticeDays: number): Promise<boolean> {
        const result = await this.db.query(`SELECT $1::timestamptz <= NOW() - make_interval(days => $2) AS elapsed`, [warnedAt, noticeDays]);
        return result.rows[0].elapsed;
    }
}
