/**
 * Data access for email verification: the pending links in
 * `user_email_verifications` and `users.email_verified`. See
 * EmailVerificationService.ts for the business rules.
 */
import {Pool, PoolClient} from "pg";

/** A pending, unexpired verification link. */
export interface PendingEmailVerification {
    userId: number;
    /** Set for an email change awaiting confirmation; null for a new registration. */
    newEmail: string | null;
    /** The account's `disabled` flag, i.e. still waiting for admin approval. */
    disabled: boolean;
}

/** An unverified account that could be sent a new link. */
export interface UnverifiedAccount {
    id: number;
    email: string;
    /** Whether a link was already sent within the resend cooldown. */
    recentlySent: boolean;
}

/** Data access for email verification. */
export class EmailVerificationRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Stores a link for a user, replacing any earlier one.
     * @param userId Owning user's id.
     * @param tokenHash SHA-256 hex of the token.
     * @param newEmail Address awaiting confirmation, or null for a registration.
     * @param ttlHours Lifetime of the link.
     */
    public async saveToken(userId: number, tokenHash: string, newEmail: string | null, ttlHours: number): Promise<void> {
        await this.db.query(
            `INSERT INTO user_email_verifications (user_id, token_hash, new_email, sent_at, expires_at)
             VALUES ($1, $2, $3, NOW(), NOW() + make_interval(hours => $4))
             ON CONFLICT (user_id) DO UPDATE
                SET token_hash = EXCLUDED.token_hash, new_email = EXCLUDED.new_email,
                    sent_at = EXCLUDED.sent_at, expires_at = EXCLUDED.expires_at`,
            [userId, tokenHash, newEmail, ttlHours]
        );
    }

    /**
     * Deletes and returns an unexpired link, so it can only be used once.
     * @param tokenHash SHA-256 hex of the token.
     * @returns The pending verification, or null if unknown or expired.
     */
    public async consumeToken(tokenHash: string): Promise<PendingEmailVerification | null> {
        const result = await this.db.query(
            `DELETE FROM user_email_verifications v
              USING users u
              WHERE v.token_hash = $1 AND v.expires_at > NOW() AND u.id = v.user_id
            RETURNING v.user_id AS "userId", v.new_email AS "newEmail", u.disabled`,
            [tokenHash]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Drops a user's pending link, if any.
     * @param userId Owning user's id.
     */
    public async deleteForUser(userId: number): Promise<void> {
        await this.db.query(`DELETE FROM user_email_verifications WHERE user_id = $1`, [userId]);
    }

    /**
     * Marks the account's email as verified.
     * @param userId Owning user's id.
     */
    public async markVerified(userId: number): Promise<void> {
        await this.db.query(`UPDATE users SET email_verified = TRUE WHERE id = $1`, [userId]);
    }

    /**
     * Applies a confirmed email change.
     * @param userId Owning user's id.
     * @param email The confirmed address.
     * @throws The raw pg error (code 23505) if another account took the address meanwhile.
     */
    public async applyNewEmail(userId: number, email: string): Promise<void> {
        await this.db.query(`UPDATE users SET email = $2, email_verified = TRUE WHERE id = $1`, [userId, email]);
    }

    /**
     * Checks whether another account already uses an address.
     * @param userId The account asking.
     * @param email Candidate address.
     * @returns Whether it belongs to someone else.
     */
    public async emailTaken(userId: number, email: string): Promise<boolean> {
        const result = await this.db.query(`SELECT 1 FROM users WHERE email = $1 AND id <> $2`, [email, userId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Looks up an unverified account by login code or email.
     * @param usernameOrEmail Same input as the login form.
     * @param cooldownSeconds Minimum time between two links.
     * @returns The account, or null if none is waiting for verification.
     */
    public async findUnverified(usernameOrEmail: string, cooldownSeconds: number): Promise<UnverifiedAccount | null> {
        const column = usernameOrEmail.includes("@") ? "u.email" : "u.code";
        const result = await this.db.query(
            `SELECT u.id, u.email,
                    COALESCE(v.sent_at > NOW() - make_interval(secs => $2), FALSE) AS "recentlySent"
               FROM users u
               LEFT JOIN user_email_verifications v ON v.user_id = u.id
              WHERE ${column} = $1 AND u.email_verified = FALSE`,
            [usernameOrEmail, cooldownSeconds]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Finds never-verified accounts whose link has expired and that hold the given code or email.
     * @param code Login code being registered.
     * @param email Email being registered.
     * @returns Their ids.
     */
    public async findAbandonedIds(code: string, email: string): Promise<number[]> {
        const result = await this.db.query(
            `SELECT u.id
               FROM users u
              WHERE (u.code = $1 OR u.email = $2)
                AND u.email_verified = FALSE
                AND NOT EXISTS (SELECT 1 FROM user_email_verifications v WHERE v.user_id = u.id AND v.expires_at > NOW())`,
            [code, email]
        );
        return result.rows.map((row) => row.id);
    }
}
