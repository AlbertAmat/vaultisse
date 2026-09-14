/**
 * Bookkeeping for `user_sessions` - one row per issued login session,
 * powering Settings > Security's "Active sessions" list and per-session
 * revocation. See AppService.createSessionToken (the `sid` claim embeds
 * `session_key`) and AuthMiddleware.ts (the per-request lookup).
 */
import {Pool, PoolClient} from "pg";
import crypto from "crypto";
import {UserSession} from "../types/user";

export interface CreatedSession {
    /** Opaque random value embedded in the session JWT's `sid` claim - never the JWT itself. */
    sessionKey: string;
    /** DB id of the new `user_sessions` row. */
    sessionId: number;
}

/** Data access for the `user_sessions` table. */
export class UserSessionRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Insert a new `user_sessions` row for a fresh login/2FA completion.
     * @param userId The account signing in.
     * @param userAgent The request's `User-Agent` header, if any.
     * @param ipAddress The request's client IP, if any.
     * @returns The new session's key and row id.
     */
    public async createUserSession(
        userId: number,
        userAgent: string | undefined,
        ipAddress: string | undefined
    ): Promise<CreatedSession> {
        const sessionKey = crypto.randomUUID();

        const result = await this.db.query(
            `INSERT INTO user_sessions (user_id, session_key, user_agent, ip_address)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [userId, sessionKey, userAgent ?? null, ipAddress ?? null]
        );

        return {sessionKey, sessionId: result.rows[0].id};
    }

    /**
     * Sessions not explicitly revoked and seen within `cutoff` - a session whose JWT simply expired drops off on its own instead of lingering forever.
     * @param userId Owning user's id.
     * @param cutoff Only sessions last seen after this time are included.
     * @returns Every matching active session.
     */
    public async listActive(userId: number, cutoff: Date): Promise<UserSession[]> {
        const result = await this.db.query(
            `SELECT id, user_agent AS "userAgent", ip_address AS "ipAddress",
                    created_date AS "createdDate", last_seen_date AS "lastSeenDate"
               FROM user_sessions
              WHERE user_id = $1
                AND revoked_date IS NULL
                AND last_seen_date > $2
              ORDER BY last_seen_date DESC`,
            [userId, cutoff]
        );
        return result.rows;
    }

    /**
     * Revokes one session, scoped to `userId`.
     * @param sessionId Session id.
     * @param userId Owning user's id.
     * @returns Whether a matching, not-already-revoked session was found and revoked.
     */
    public async revoke(sessionId: number, userId: number): Promise<boolean> {
        const result = await this.db.query(
            `UPDATE user_sessions
                SET revoked_date = NOW()
              WHERE id = $1 AND user_id = $2 AND revoked_date IS NULL
            RETURNING id`,
            [sessionId, userId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Revokes every other active session for `userId` - used after a password change, since their tokens are already dead via the token_version bump.
     * @param userId Owning user's id.
     * @param exceptSessionId Session id to leave untouched.
     */
    public async revokeAllExcept(userId: number, exceptSessionId: number): Promise<void> {
        await this.db.query(
            `UPDATE user_sessions SET revoked_date = NOW() WHERE user_id = $1 AND id != $2 AND revoked_date IS NULL`,
            [userId, exceptSessionId]
        );
    }

    /**
     * Used by AuthMiddleware.resolveSession to check a token's `sid` claim against a live, not-revoked session on every authenticated request.
     * @param sessionKey Session key (the JWT's `sid` claim).
     * @param userId Owning user's id.
     * @returns The matching session's id, or null.
     */
    public async findActive(sessionKey: string, userId: number): Promise<{id: number} | null> {
        const result = await this.db.query(
            `SELECT id FROM user_sessions WHERE session_key = $1 AND user_id = $2 AND revoked_date IS NULL`,
            [sessionKey, userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Best-effort, throttled (only writes once the row is more than a minute stale) - keeps "Active sessions" reasonably fresh without a DB write on every single authenticated request. Caller is expected to fire-and-forget this (see AuthMiddleware), not await it.
     * @param sessionId Session id to touch.
     */
    public async touchLastSeen(sessionId: number): Promise<void> {
        await this.db.query(
            `UPDATE user_sessions SET last_seen_date = NOW() WHERE id = $1 AND last_seen_date < NOW() - INTERVAL '1 minute'`,
            [sessionId]
        );
    }
}
