import {Pool, PoolClient} from "pg";
import {ActivityLogEntry, ProfileUpdateFields, UserProfile} from "../types/user";

/** Data access for the `users` table (self-service account management) plus its 2FA/backup-code/acknowledgement side tables. See UserService for the business rules built on top of this. */
export class UserRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Fetch `userId`'s profile fields, converting the stored `image` bytea (if
     * any) into a `data:image/png;base64,...` URL the client can use directly
     * as an `<img src>`. Throws if the user doesn't exist.
     * @param userId Owning user's id.
     * @returns The user's profile.
     */
    public async getProfile(userId: number): Promise<UserProfile> {
        const result = await this.db.query(
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
                    u.last_used_vault_id    as "activeVault",
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
     * @param userId Owning user's id.
     */
    public async recordSecurityNoticeSent(userId: number): Promise<void> {
        await this.db.query(
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
     * @param userId Owning user's id.
     */
    public async recordTermsOfServiceSent(userId: number): Promise<void> {
        await this.db.query(
            `INSERT INTO user_terms_of_service_acknowledgements (user_id)
             VALUES ($1)
             ON CONFLICT (user_id) DO NOTHING`,
            [userId]
        );
    }

    /* ---------- Profile / preferences ---------- */

    /**
     * Sets the caller's profile image.
     * @param userId Owning user's id.
     * @param image Raw image bytes.
     */
    public async updateImage(userId: number, image: Buffer): Promise<void> {
        await this.db.query(`UPDATE users SET image = $1 WHERE id = $2`, [image, userId]);
    }

    /**
     * Clears the caller's profile image.
     * @param userId Owning user's id.
     */
    public async removeImage(userId: number): Promise<void> {
        await this.db.query(`UPDATE users SET image = null WHERE id = $1`, [userId]);
    }

    /**
     * Updates the caller's name/email/language/region.
     * @param userId Owning user's id.
     * @param fields New field values.
     */
    public async updateProfile(userId: number, fields: ProfileUpdateFields): Promise<void> {
        await this.db.query(
            `UPDATE users SET name = $1, email = $2, language = $3, region = $4 WHERE id = $5`,
            [fields.name, fields.email, fields.language, fields.region, userId]
        );
    }

    /**
     * Updates the caller's UI theme preference.
     * @param userId Owning user's id.
     * @param theme New theme.
     */
    public async updateTheme(userId: number, theme: string): Promise<void> {
        await this.db.query(`UPDATE users SET theme = $1 WHERE id = $2`, [theme, userId]);
    }

    /**
     * Updates whether the caller's left nav collapses to icon-only "rail" mode.
     * @param userId Owning user's id.
     * @param sidebarRail New preference.
     */
    public async updateSidebarRail(userId: number, sidebarRail: boolean): Promise<void> {
        await this.db.query(`UPDATE users SET sidebar_rail = $1 WHERE id = $2`, [sidebarRail, userId]);
    }

    /**
     * Updates whether the caller's Loans/Customers pages are shown.
     * @param userId Owning user's id.
     * @param leasingEnabled New preference.
     */
    public async updateLeasing(userId: number, leasingEnabled: boolean): Promise<void> {
        await this.db.query(`UPDATE users SET leasing_enabled = $1 WHERE id = $2`, [leasingEnabled, userId]);
    }

    /**
     * Sets which vault the caller last worked in, so it's the one loaded on next login. Caller must
     * first verify the caller is actually a member of `vaultId` - this just writes the column.
     * @param userId Owning user's id.
     * @param vaultId Vault to make active.
     */
    public async setActiveVault(userId: number, vaultId: number): Promise<void> {
        await this.db.query(`UPDATE users SET last_used_vault_id = $1 WHERE id = $2`, [vaultId, userId]);
    }

    /* ---------- Password / account ---------- */

    /**
     * Looks up a user's stored password hash.
     * @param userId Owning user's id.
     * @returns The password hash, or null if the user doesn't exist.
     */
    public async getPasswordHash(userId: number): Promise<string | null> {
        const result = await this.db.query(`SELECT password FROM users WHERE id = $1`, [userId]);
        return result.rows[0]?.password ?? null;
    }

    /**
     * Permanently deletes a user account.
     * @param userId Owning user's id.
     */
    public async deleteAccount(userId: number): Promise<void> {
        await this.db.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }

    /**
     * Bumps `token_version` (invalidating every previously issued session
     * token for this user - see AppService.createSessionToken /
     * AuthMiddleware's check of it) alongside the new password hash.
     * @param userId Owning user's id.
     * @param hashedPassword New password hash.
     * @returns The new token_version, for reissuing a token for the caller's own session.
     */
    public async updatePassword(userId: number, hashedPassword: string): Promise<number> {
        const result = await this.db.query(
            `UPDATE users SET password = $1, token_version = token_version + 1 WHERE id = $2 RETURNING token_version`,
            [hashedPassword, userId]
        );
        return result.rows[0].token_version;
    }

    /* ---------- Two-factor auth ---------- */

    /**
     * Looks up a user's email address.
     * @param userId Owning user's id.
     * @returns The email, or null if the user doesn't exist.
     */
    public async getEmail(userId: number): Promise<string | null> {
        const result = await this.db.query(`SELECT email FROM users WHERE id = $1`, [userId]);
        return result.rows[0]?.email ?? null;
    }

    /**
     * Stores a freshly-generated TOTP secret, without enabling 2FA yet.
     * @param userId Owning user's id.
     * @param secret New TOTP secret.
     */
    public async setTotpSecret(userId: number, secret: string): Promise<void> {
        await this.db.query(`UPDATE users SET totp_secret = $1 WHERE id = $2`, [secret, userId]);
    }

    /**
     * Looks up a user's stored (pending or active) TOTP secret.
     * @param userId Owning user's id.
     * @returns The secret, or null if none is stored.
     */
    public async getTotpSecret(userId: number): Promise<string | null> {
        const result = await this.db.query(`SELECT totp_secret FROM users WHERE id = $1`, [userId]);
        return result.rows[0]?.totp_secret ?? null;
    }

    /**
     * Turns two-factor auth on.
     * @param userId Owning user's id.
     */
    public async enableTwoFactor(userId: number): Promise<void> {
        // Also clears any stale 2FA-lockout/replay state from a previous
        // enable/disable cycle (security audit #5), so a fresh setup starts clean.
        await this.db.query(
            `UPDATE users
                SET totp_enabled = TRUE, totp_failed_count = 0, totp_lockout_until = NULL, totp_last_used_step = NULL
              WHERE id = $1`,
            [userId]
        );
    }

    /**
     * Turns two-factor auth off and clears the stored secret.
     * @param userId Owning user's id.
     */
    public async disableTwoFactor(userId: number): Promise<void> {
        await this.db.query(
            `UPDATE users
                SET totp_enabled = FALSE, totp_secret = NULL,
                    totp_failed_count = 0, totp_lockout_until = NULL, totp_last_used_step = NULL
              WHERE id = $1`,
            [userId]
        );
    }

    /**
     * Discards any codes from a previous enable/setup cycle, then stores the fresh set.
     * @param userId Owning user's id.
     * @param hashedCodes Freshly-hashed backup codes.
     */
    public async replaceBackupCodes(userId: number, hashedCodes: string[]): Promise<void> {
        await this.db.query(`DELETE FROM user_backup_codes WHERE user_id = $1`, [userId]);
        for (const hash of hashedCodes) {
            await this.db.query(`INSERT INTO user_backup_codes (user_id, code_hash) VALUES ($1, $2)`, [userId, hash]);
        }
    }

    /**
     * Deletes every stored backup code for a user.
     * @param userId Owning user's id.
     */
    public async deleteBackupCodes(userId: number): Promise<void> {
        await this.db.query(`DELETE FROM user_backup_codes WHERE user_id = $1`, [userId]);
    }

    /* ---------- Acknowledgements (explicit accept - distinct from PolicyService's record-on-first-serve) ---------- */

    /**
     * Records explicit acceptance of the security notice. Idempotent - accepting more than once just refreshes `accepted_date`.
     * @param userId Owning user's id.
     */
    public async acceptSecurityNotice(userId: number): Promise<void> {
        await this.db.query(
            `INSERT INTO user_security_notice_acknowledgements (user_id, accepted_date)
             VALUES ($1, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id) DO UPDATE SET accepted_date = CURRENT_TIMESTAMP`,
            [userId]
        );
    }

    /**
     * Records explicit acceptance of the Terms of Service. Idempotent - accepting more than once just refreshes `accepted_date`.
     * @param userId Owning user's id.
     */
    public async acceptTermsOfService(userId: number): Promise<void> {
        await this.db.query(
            `INSERT INTO user_terms_of_service_acknowledgements (user_id, accepted_date)
             VALUES ($1, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id) DO UPDATE SET accepted_date = CURRENT_TIMESTAMP`,
            [userId]
        );
    }

    /* ---------- Activity log (read side - writes are ActivityLogRepository.recordActivity) ---------- */

    /**
     * Auth events only (login/login_failed/logout/password_changed) - `activity_log` is a generic table that may later carry other event kinds too.
     * @param userId Owning user's id.
     * @param actions Action types to include.
     * @param limit Maximum rows to return.
     * @returns Every matching activity-log entry.
     */
    public async listActivity(userId: number, actions: string[], limit: number): Promise<ActivityLogEntry[]> {
        const result = await this.db.query(
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
}
