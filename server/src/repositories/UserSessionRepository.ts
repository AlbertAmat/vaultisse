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

/**
 * Insert a new `user_sessions` row for a fresh login/2FA completion.
 * @param db Pool or client to run the query on.
 * @param userId The account signing in.
 * @param userAgent The request's `User-Agent` header, if any.
 * @param ipAddress The request's client IP, if any.
 */
export async function createUserSession(
    db: Pool | PoolClient,
    userId: number,
    userAgent: string | undefined,
    ipAddress: string | undefined
): Promise<CreatedSession> {
    const sessionKey = crypto.randomUUID();

    const result = await db.query(
        `INSERT INTO user_sessions (user_id, session_key, user_agent, ip_address)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [userId, sessionKey, userAgent ?? null, ipAddress ?? null]
    );

    return {sessionKey, sessionId: result.rows[0].id};
}

/** Sessions not explicitly revoked and seen within `cutoff` - a session whose JWT simply expired drops off on its own instead of lingering forever. */
export async function listActive(db: Pool | PoolClient, userId: number, cutoff: Date): Promise<UserSession[]> {
    const result = await db.query(
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

/** @returns Whether a matching, not-already-revoked session was found and revoked. */
export async function revoke(db: Pool | PoolClient, sessionId: number, userId: number): Promise<boolean> {
    const result = await db.query(
        `UPDATE user_sessions
            SET revoked_date = NOW()
          WHERE id = $1 AND user_id = $2 AND revoked_date IS NULL
        RETURNING id`,
        [sessionId, userId]
    );
    return (result.rowCount ?? 0) > 0;
}

/** Revokes every other active session for `userId` - used after a password change, since their tokens are already dead via the token_version bump. */
export async function revokeAllExcept(db: Pool | PoolClient, userId: number, exceptSessionId: number): Promise<void> {
    await db.query(
        `UPDATE user_sessions SET revoked_date = NOW() WHERE user_id = $1 AND id != $2 AND revoked_date IS NULL`,
        [userId, exceptSessionId]
    );
}

/** Used by AuthMiddleware.resolveSession to check a token's `sid` claim against a live, not-revoked session on every authenticated request. */
export async function findActive(db: Pool | PoolClient, sessionKey: string, userId: number): Promise<{id: number} | null> {
    const result = await db.query(
        `SELECT id FROM user_sessions WHERE session_key = $1 AND user_id = $2 AND revoked_date IS NULL`,
        [sessionKey, userId]
    );
    return result.rows[0] ?? null;
}

/** Best-effort, throttled (only writes once the row is more than a minute stale) - keeps "Active sessions" reasonably fresh without a DB write on every single authenticated request. Caller is expected to fire-and-forget this (see AuthMiddleware), not await it. */
export async function touchLastSeen(db: Pool | PoolClient, sessionId: number): Promise<void> {
    await db.query(
        `UPDATE user_sessions SET last_seen_date = NOW() WHERE id = $1 AND last_seen_date < NOW() - INTERVAL '1 minute'`,
        [sessionId]
    );
}
