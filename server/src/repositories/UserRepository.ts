import {Pool, PoolClient} from "pg";
import {ActivityLogEntry, ProfileUpdateFields, UserProfile} from "../types/user";

/**
 * Fetch `userId`'s profile fields, converting the stored `image` bytea (if
 * any) into a `data:image/png;base64,...` URL the client can use directly
 * as an `<img src>`. Throws if the user doesn't exist.
 */
export async function getProfile(db: Pool | PoolClient, userId: number): Promise<UserProfile> {
    const result = await db.query(
        `SELECT u.code,
                u.name,
                u.email,
                u.language,
                u.region,
                u.image,
                u.theme,
                u.sidebar_rail          AS "sidebarRail",
                u.leasing_enabled       AS "leasingEnabled",
                u.is_public_institution AS "isPublicInstitution",
                u.totp_enabled          AS "totpEnabled",
                (sn.accepted_date IS NOT NULL)  AS "securityNoticeAccepted",
                (tos.accepted_date IS NOT NULL) AS "termsOfServiceAccepted"
           FROM users u
           LEFT JOIN user_security_notice_acknowledgements sn ON sn.user_id = u.id
           LEFT JOIN user_terms_of_service_acknowledgements tos ON tos.user_id = u.id
          WHERE u.id = $1`,
        [userId]
    );

    if (result.rows.length === 0) {
        throw new Error("User not found");
    }

    const user = result.rows[0];
    user.image = user.image ? `data:image/png;base64,${user.image.toString('base64')}` : null;
    return user;
}

/**
 * Ensures a `user_security_notice_acknowledgements` row exists for `userId`,
 * recording "now" as `sent_date` the first time it's called for that user.
 * `ON CONFLICT DO NOTHING` makes every later call for an already-recorded
 * user a no-op, so `sent_date` always reflects the first time the notice
 * was actually shown.
 */
export async function recordSecurityNoticeSent(db: Pool | PoolClient, userId: number): Promise<void> {
    await db.query(
        `INSERT INTO user_security_notice_acknowledgements (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
    );
}

/**
 * Ensures a `user_terms_of_service_acknowledgements` row exists for `userId`,
 * recording "now" as `sent_date` the first time it's called for that user.
 * Same no-op-after-first-call pattern as `recordSecurityNoticeSent`.
 */
export async function recordTermsOfServiceSent(db: Pool | PoolClient, userId: number): Promise<void> {
    await db.query(
        `INSERT INTO user_terms_of_service_acknowledgements (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
    );
}

/* ---------- Profile / preferences ---------- */

export async function updateImage(db: Pool | PoolClient, userId: number, image: Buffer): Promise<void> {
    await db.query(`UPDATE users SET image = $1 WHERE id = $2`, [image, userId]);
}

export async function removeImage(db: Pool | PoolClient, userId: number): Promise<void> {
    await db.query(`UPDATE users SET image = null WHERE id = $1`, [userId]);
}

export async function updateProfile(db: Pool | PoolClient, userId: number, fields: ProfileUpdateFields): Promise<void> {
    await db.query(
        `UPDATE users SET name = $1, email = $2, language = $3, region = $4 WHERE id = $5`,
        [fields.name, fields.email, fields.language, fields.region, userId]
    );
}

export async function updateTheme(db: Pool | PoolClient, userId: number, theme: string): Promise<void> {
    await db.query(`UPDATE users SET theme = $1 WHERE id = $2`, [theme, userId]);
}

export async function updateSidebarRail(db: Pool | PoolClient, userId: number, sidebarRail: boolean): Promise<void> {
    await db.query(`UPDATE users SET sidebar_rail = $1 WHERE id = $2`, [sidebarRail, userId]);
}

export async function updateLeasing(db: Pool | PoolClient, userId: number, leasingEnabled: boolean): Promise<void> {
    await db.query(`UPDATE users SET leasing_enabled = $1 WHERE id = $2`, [leasingEnabled, userId]);
}

/* ---------- Password / account ---------- */

export async function getPasswordHash(db: Pool | PoolClient, userId: number): Promise<string | null> {
    const result = await db.query(`SELECT password FROM users WHERE id = $1`, [userId]);
    return result.rows[0]?.password ?? null;
}

export async function deleteAccount(db: Pool | PoolClient, userId: number): Promise<void> {
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

/**
 * Bumps `token_version` (invalidating every previously issued session
 * token for this user - see AppService.createSessionToken /
 * AuthMiddleware's check of it) alongside the new password hash.
 * @returns The new token_version, for reissuing a token for the caller's own session.
 */
export async function updatePassword(db: Pool | PoolClient, userId: number, hashedPassword: string): Promise<number> {
    const result = await db.query(
        `UPDATE users SET password = $1, token_version = token_version + 1 WHERE id = $2 RETURNING token_version`,
        [hashedPassword, userId]
    );
    return result.rows[0].token_version;
}

/* ---------- Two-factor auth ---------- */

export async function getEmail(db: Pool | PoolClient, userId: number): Promise<string | null> {
    const result = await db.query(`SELECT email FROM users WHERE id = $1`, [userId]);
    return result.rows[0]?.email ?? null;
}

export async function setTotpSecret(db: Pool | PoolClient, userId: number, secret: string): Promise<void> {
    await db.query(`UPDATE users SET totp_secret = $1 WHERE id = $2`, [secret, userId]);
}

export async function getTotpSecret(db: Pool | PoolClient, userId: number): Promise<string | null> {
    const result = await db.query(`SELECT totp_secret FROM users WHERE id = $1`, [userId]);
    return result.rows[0]?.totp_secret ?? null;
}

export async function enableTwoFactor(db: Pool | PoolClient, userId: number): Promise<void> {
    await db.query(`UPDATE users SET totp_enabled = TRUE WHERE id = $1`, [userId]);
}

export async function disableTwoFactor(db: Pool | PoolClient, userId: number): Promise<void> {
    await db.query(`UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1`, [userId]);
}

/** Discards any codes from a previous enable/setup cycle, then stores the fresh set. */
export async function replaceBackupCodes(db: Pool | PoolClient, userId: number, hashedCodes: string[]): Promise<void> {
    await db.query(`DELETE FROM user_backup_codes WHERE user_id = $1`, [userId]);
    for (const hash of hashedCodes) {
        await db.query(`INSERT INTO user_backup_codes (user_id, code_hash) VALUES ($1, $2)`, [userId, hash]);
    }
}

export async function deleteBackupCodes(db: Pool | PoolClient, userId: number): Promise<void> {
    await db.query(`DELETE FROM user_backup_codes WHERE user_id = $1`, [userId]);
}

/* ---------- Acknowledgements (explicit accept - distinct from PolicyService's record-on-first-serve) ---------- */

/** Idempotent - accepting more than once just refreshes `accepted_date`. */
export async function acceptSecurityNotice(db: Pool | PoolClient, userId: number): Promise<void> {
    await db.query(
        `INSERT INTO user_security_notice_acknowledgements (user_id, accepted_date)
         VALUES ($1, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET accepted_date = CURRENT_TIMESTAMP`,
        [userId]
    );
}

/** Idempotent - accepting more than once just refreshes `accepted_date`. */
export async function acceptTermsOfService(db: Pool | PoolClient, userId: number): Promise<void> {
    await db.query(
        `INSERT INTO user_terms_of_service_acknowledgements (user_id, accepted_date)
         VALUES ($1, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET accepted_date = CURRENT_TIMESTAMP`,
        [userId]
    );
}

/* ---------- Activity log (read side - writes are ActivityLogRepository.recordActivity) ---------- */

/** Auth events only (login/login_failed/logout/password_changed) - `activity_log` is a generic table that may later carry other event kinds too. */
export async function listActivity(db: Pool | PoolClient, userId: number, actions: string[], limit: number): Promise<ActivityLogEntry[]> {
    const result = await db.query(
        `SELECT id, action, metadata, created_date AS "createdDate"
           FROM activity_log
          WHERE actor_id = $1
            AND action = ANY($2)
          ORDER BY created_date DESC
          LIMIT $3`,
        [userId, actions, limit]
    );
    return result.rows;
}
