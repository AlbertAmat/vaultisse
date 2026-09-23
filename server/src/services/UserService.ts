import {Pool} from "pg";
import {appService} from "../AppService";
import {UserRepository} from "../repositories/UserRepository";
import {UserSessionRepository} from "../repositories/UserSessionRepository";
import {VaultRepository} from "../repositories/VaultRepository";
import {ActivityLogRepository, ActivityAction} from "../repositories/ActivityLogRepository";
import {withTransaction} from "../repositories/withTransaction";
import {TwoFactorAuth} from "../utils/TwoFactorAuth";
import {ActivityLogEntry, ProfileUpdateFields, TwoFactorSetup, UserSession} from "../types/user";
import {ConflictError, NotFoundError, UnauthorizedError, ValidationError} from "../errors/DomainError";

/** Thrown by changePassword when the new password fails a strength rule - carries the same `missing` list the original inline check returned. */
export class WeakPasswordError extends ValidationError {
    public constructor(public readonly missing: string[]) {
        super("Password does not meet the requirements");
    }
}

export interface PasswordChangeResult {
    newToken: string;
}

/**
 * Business rules for the User resource (self-service account management).
 * Calls UserRepository/UserSessionRepository/ActivityLogRepository; throws
 * DomainError subclasses for expected failures.
 *
 * Unlike most other services in this refactor, this one imports `appService`
 * directly - for `comparePassword`/`hashPassword`/`createSessionToken`/
 * `getSessionTime` only, never for `getDatabasePool()` (still passed in as
 * `pool`, same as everywhere else). Those are bcrypt/JWT operations bound to
 * AppService's own instance state (the JWT secret), not something sensibly
 * extracted into a "repository". AuthService does the same for the same
 * reason.
 */
export class UserService {
    /**
     * @param pool Database connection pool, forwarded to fresh repositories on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Sets the caller's profile image.
     * @param userId Owning user's id.
     * @param image Raw image bytes.
     */
    public async updateImage(userId: number, image: Buffer): Promise<void> {
        await new UserRepository(this.pool).updateImage(userId, image);
    }

    /**
     * Clears the caller's profile image.
     * @param userId Owning user's id.
     */
    public async removeImage(userId: number): Promise<void> {
        await new UserRepository(this.pool).removeImage(userId);
    }

    /**
     * Updates the caller's profile fields. Changing the email requires
     * re-entering the current password (security audit #8): without this,
     * anyone holding a session (a stolen cookie, an unlocked laptop) could
     * silently redirect the account's email - the pivot point for takeover
     * via password reset, or for hijacking a future OIDC/SSO first login
     * (see OidcUserService.findOrCreateOidcUser).
     *
     * @param userId Owning user's id.
     * @param fields New field values.
     * @param currentPassword Current password - required only when `fields.email` differs from the stored one.
     * @throws UnauthorizedError (401) if the email is being changed and `currentPassword` doesn't match.
     */
    public async updateProfile(userId: number, fields: ProfileUpdateFields, currentPassword: string | undefined): Promise<void> {
        const repo = new UserRepository(this.pool);

        const currentEmail = await repo.getEmail(userId);
        const changingEmail = currentEmail !== null && fields.email !== currentEmail;
        if (changingEmail) {
            const hash = await repo.getPasswordHash(userId);
            if (!hash || !currentPassword || !(await appService.comparePassword(currentPassword, hash))) {
                throw new UnauthorizedError("Current password is required to change your email.");
            }
        }

        await repo.updateProfile(userId, fields);
    }

    /**
     * Updates the caller's UI theme, throwing ValidationError for anything other than "beige"/"library".
     * @param userId Owning user's id.
     * @param theme New theme.
     */
    public async updateTheme(userId: number, theme: string): Promise<void> {
        if (theme !== "beige" && theme !== "library") {
            throw new ValidationError("Invalid theme");
        }
        await new UserRepository(this.pool).updateTheme(userId, theme);
    }

    /**
     * Updates the caller's sidebar-rail preference, throwing ValidationError if it isn't a boolean.
     * @param userId Owning user's id.
     * @param sidebarRail New preference.
     */
    public async updateSidebarRail(userId: number, sidebarRail: unknown): Promise<void> {
        if (typeof sidebarRail !== "boolean") {
            throw new ValidationError("Invalid sidebarRail");
        }
        await new UserRepository(this.pool).updateSidebarRail(userId, sidebarRail);
    }

    /**
     * Updates the caller's leasing-enabled preference, throwing ValidationError if it isn't a boolean.
     * @param userId Owning user's id.
     * @param leasingEnabled New preference.
     */
    public async updateLeasing(userId: number, leasingEnabled: unknown): Promise<void> {
        if (typeof leasingEnabled !== "boolean") {
            throw new ValidationError("Invalid leasingEnabled");
        }
        await new UserRepository(this.pool).updateLeasing(userId, leasingEnabled);
    }

    /**
     * Deletes the caller's account after re-verifying their password.
     *
     * Any vault this account is the *sole* member of (its personal library,
     * for almost every account - see AuthService.register's bootstrap) is
     * torn down first, content and all: `books`/`customers`/etc. only
     * restrict-delete their vault, they don't cascade from it, so the vault
     * itself can't just be left for `ON DELETE CASCADE` from `users` to
     * clean up (see VaultRepository.deleteVaultCompletely). A vault shared
     * with other members is left untouched even if this account is its only
     * admin - deciding what happens to a shared vault when its one admin
     * leaves is a Vault-management decision the caller should make
     * explicitly (transfer admin, or promote another member) before
     * deleting their own account, not something account deletion should
     * decide silently. `trg_vault_min_one_admin` (assets/db/upgrade/1.3.0.sql)
     * then rejects the whole deletion with a clear error, mapped to
     * ConflictError below, rather than a raw 500.
     *
     * @param userId Owning user's id.
     * @param password Current password, for re-authentication.
     * @throws UnauthorizedError (401, matching the original route) if `password` doesn't match.
     * @throws ConflictError (409) if this account is the sole admin of a vault it shares with other members.
     */
    public async deleteAccount(userId: number, password: string): Promise<void> {
        const repo = new UserRepository(this.pool);
        const hash = await repo.getPasswordHash(userId);
        if (!hash || !(await appService.comparePassword(password, hash))) {
            throw new UnauthorizedError("Invalid password.");
        }

        try {
            await withTransaction(this.pool, async (client) => {
                const vaultRepo = new VaultRepository(client);
                const soleVaultIds = await vaultRepo.findSoleMemberVaultIds(userId);
                for (const vaultId of soleVaultIds) {
                    await vaultRepo.deleteVaultCompletely(vaultId);
                }
                await new UserRepository(client).deleteAccount(userId);
            });
        } catch (error: any) {
            if (error.code === "P0001") {
                throw new ConflictError("You're the only admin of a shared vault - transfer admin to another member, or delete the vault, before deleting your account.");
            }
            throw error;
        }
    }

    /**
     * Validates the new password against the same rules as registration,
     * bumps token_version (invalidating every other previously issued
     * session token), revokes every other user_sessions row, records the
     * change in the activity log, then issues a fresh token for *this*
     * session so the caller isn't logged out.
     *
     * @param userId Owning user's id.
     * @param currentPassword Current password, for re-authentication.
     * @param newPassword Requested new password.
     * @param sessionId The caller's own session id, left un-revoked.
     * @param sessionKey The caller's own session key, reused for the reissued token.
     * @param ip Caller's IP, recorded on the activity log entry.
     * @returns The reissued session token.
     */
    public async changePassword(
        userId: number,
        currentPassword: string,
        newPassword: string,
        sessionId: number | undefined,
        sessionKey: string,
        ip: string | undefined
    ): Promise<PasswordChangeResult> {
        const userRepo = new UserRepository(this.pool);
        const hash = await userRepo.getPasswordHash(userId);
        if (!hash) {
            throw new UnauthorizedError("Invalid username or password.");
        }
        if (!(await appService.comparePassword(currentPassword, hash))) {
            throw new UnauthorizedError("Invalid current password.");
        }

        const missing: string[] = [];
        if (newPassword.length < 8) missing.push("At least 8 characters");
        if (!/[A-Z]/.test(newPassword)) missing.push("At least one uppercase letter");
        if (!/[0-9]/.test(newPassword)) missing.push("At least one number");
        if (!/[^A-Za-z0-9]/.test(newPassword)) missing.push("At least one special character");
        if (missing.length > 0) {
            throw new WeakPasswordError(missing);
        }

        const newHashedPassword = await appService.hashPassword(newPassword);
        const newTokenVersion = await userRepo.updatePassword(userId, newHashedPassword);

        if (sessionId) {
            await new UserSessionRepository(this.pool).revokeAllExcept(userId, sessionId);
        }

        await new ActivityLogRepository(this.pool).recordActivity(userId, ActivityAction.PASSWORD_CHANGED, {metadata: {ip}});

        const newToken = appService.createSessionToken(userId, newTokenVersion, sessionKey);
        return {newToken};
    }

    /**
     * Lists the caller's active sessions, flagging the current one.
     * @param userId Owning user's id.
     * @param currentSessionId The caller's own session id.
     * @returns Every active session, each with `isCurrent`.
     */
    public async listSessions(userId: number, currentSessionId: number | undefined): Promise<Array<UserSession & {isCurrent: boolean}>> {
        const cutoff = new Date(Date.now() - appService.getSessionTime());
        const sessions = await new UserSessionRepository(this.pool).listActive(userId, cutoff);
        return sessions.map((session) => ({...session, isCurrent: session.id === currentSessionId}));
    }

    /**
     * Revokes one of the caller's own sessions.
     * @param userId Owning user's id.
     * @param sessionId Session id to revoke.
     * @param ip Caller's IP, recorded on the activity log entry.
     * @returns Whether the revoked session was the caller's own current one (controller clears their cookie if so).
     */
    public async revokeSession(userId: number, sessionId: number, ip: string | undefined): Promise<boolean> {
        const revoked = await new UserSessionRepository(this.pool).revoke(sessionId, userId);
        if (!revoked) {
            throw new NotFoundError("Session not found");
        }
        await new ActivityLogRepository(this.pool).recordActivity(userId, ActivityAction.LOGOUT, {metadata: {ip, sessionId}});
        return true;
    }

    /**
     * Lists the caller's recent auth activity, capped to 50 rows.
     * @param userId Owning user's id.
     * @param limit Requested row limit.
     * @returns Every matching activity-log entry.
     */
    public async listActivity(userId: number, limit: number): Promise<ActivityLogEntry[]> {
        const cappedLimit = Math.min(limit || 20, 50);
        return new UserRepository(this.pool).listActivity(userId, Object.values(ActivityAction), cappedLimit);
    }

    /**
     * Records explicit acceptance of the security notice.
     * @param userId Owning user's id.
     */
    public async acceptSecurityNotice(userId: number): Promise<void> {
        await new UserRepository(this.pool).acceptSecurityNotice(userId);
    }

    /**
     * Records explicit acceptance of the Terms of Service.
     * @param userId Owning user's id.
     */
    public async acceptTermsOfService(userId: number): Promise<void> {
        await new UserRepository(this.pool).acceptTermsOfService(userId);
    }

    /**
     * Starts (or restarts) two-factor auth setup: generates and stores a fresh TOTP secret, and returns it plus a scannable QR code.
     * @param userId Owning user's id.
     * @returns The secret and its QR code data URL.
     */
    public async setupTwoFactor(userId: number): Promise<TwoFactorSetup> {
        const repo = new UserRepository(this.pool);
        const email = await repo.getEmail(userId);
        if (email === null) {
            throw new NotFoundError("User not found");
        }

        const secret = TwoFactorAuth.generateTotpSecret();
        await repo.setTotpSecret(userId, secret);

        const otpauthUrl = TwoFactorAuth.buildOtpAuthUrl(email, secret);
        const qrCodeDataUrl = await TwoFactorAuth.generateQrCodeDataUrl(otpauthUrl);

        return {secret, qrCodeDataUrl};
    }

    /**
     * Confirms setup and turns two-factor auth on: verifies the code against the pending secret, then flips `totp_enabled` and generates a fresh set of backup codes.
     * @param userId Owning user's id.
     * @param code Verification code from the authenticator app.
     * @returns The freshly-generated backup codes (shown to the caller exactly once).
     * @throws ValidationError (400) if setup was never started, UnauthorizedError (401) if the code is wrong.
     */
    public async enableTwoFactor(userId: number, code: string): Promise<string[]> {
        const userRepo = new UserRepository(this.pool);
        const secret = await userRepo.getTotpSecret(userId);
        if (!secret) {
            throw new ValidationError("Start setup before enabling two-factor authentication.");
        }
        if (!(await TwoFactorAuth.verifyTotpCode(secret, String(code).trim())).valid) {
            throw new UnauthorizedError("Invalid verification code.");
        }

        const backupCodes = TwoFactorAuth.generateBackupCodes();
        const hashedCodes = await Promise.all(backupCodes.map((c) => appService.hashPassword(c)));

        // Flip totp_enabled and replace the backup codes as one atomic step -
        // a mid-way failure can't leave 2FA "on" with no valid codes.
        await withTransaction(this.pool, async (client) => {
            const txRepo = new UserRepository(client);
            await txRepo.enableTwoFactor(userId);
            await txRepo.replaceBackupCodes(userId, hashedCodes);
        });

        return backupCodes;
    }

    /**
     * Turns two-factor auth off after re-verifying the caller's password, clearing the secret and every backup code.
     * @param userId Owning user's id.
     * @param password Current password, for re-authentication.
     * @throws UnauthorizedError (401) if `password` doesn't match.
     */
    public async disableTwoFactor(userId: number, password: string): Promise<void> {
        const repo = new UserRepository(this.pool);
        const hash = await repo.getPasswordHash(userId);
        if (!hash || !(await appService.comparePassword(password, hash))) {
            throw new UnauthorizedError("Invalid password.");
        }
        await repo.disableTwoFactor(userId);
        await repo.deleteBackupCodes(userId);
    }
}
