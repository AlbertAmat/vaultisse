import {Pool} from "pg";
import {appService} from "../AppService";
import * as UserRepository from "../repositories/UserRepository";
import * as UserSessionRepository from "../repositories/UserSessionRepository";
import {recordActivity, ActivityAction} from "../repositories/ActivityLogRepository";
import {withTransaction} from "../repositories/withTransaction";
import {
    generateTotpSecret,
    buildOtpAuthUrl,
    generateQrCodeDataUrl,
    verifyTotpCode,
    generateBackupCodes,
} from "../utils/TwoFactorAuth";
import {ActivityLogEntry, ProfileUpdateFields, TwoFactorSetup, UserSession} from "../types/user";
import {NotFoundError, UnauthorizedError, ValidationError} from "../errors/DomainError";

/**
 * Unlike every other service in this refactor, this one imports `appService`
 * directly - for `comparePassword`/`hashPassword`/`createSessionToken`/
 * `getSessionTime` only, never for `getDatabasePool()` (still passed in as
 * `pool`, same as everywhere else). Those are bcrypt/JWT operations bound to
 * AppService's own instance state (the JWT secret), not something sensibly
 * extracted into a "repository". AuthService will make the same call for the
 * same reason.
 */

export async function updateImage(pool: Pool, userId: number, image: Buffer): Promise<void> {
    await UserRepository.updateImage(pool, userId, image);
}

export async function removeImage(pool: Pool, userId: number): Promise<void> {
    await UserRepository.removeImage(pool, userId);
}

export async function updateProfile(pool: Pool, userId: number, fields: ProfileUpdateFields): Promise<void> {
    await UserRepository.updateProfile(pool, userId, fields);
}

export async function updateTheme(pool: Pool, userId: number, theme: string): Promise<void> {
    if (theme !== "beige" && theme !== "library") {
        throw new ValidationError("Invalid theme");
    }
    await UserRepository.updateTheme(pool, userId, theme);
}

export async function updateSidebarRail(pool: Pool, userId: number, sidebarRail: unknown): Promise<void> {
    if (typeof sidebarRail !== "boolean") {
        throw new ValidationError("Invalid sidebarRail");
    }
    await UserRepository.updateSidebarRail(pool, userId, sidebarRail);
}

export async function updateLeasing(pool: Pool, userId: number, leasingEnabled: unknown): Promise<void> {
    if (typeof leasingEnabled !== "boolean") {
        throw new ValidationError("Invalid leasingEnabled");
    }
    await UserRepository.updateLeasing(pool, userId, leasingEnabled);
}

/** Throws UnauthorizedError (401, matching the original route) if `password` doesn't match. */
export async function deleteAccount(pool: Pool, userId: number, password: string): Promise<void> {
    const hash = await UserRepository.getPasswordHash(pool, userId);
    if (!hash || !(await appService.comparePassword(password, hash))) {
        throw new UnauthorizedError("Invalid password.");
    }
    await UserRepository.deleteAccount(pool, userId);
}

export interface PasswordChangeResult {
    newToken: string;
}

/** Thrown by changePassword when the new password fails a strength rule - carries the same `missing` list the original inline check returned. */
export class WeakPasswordError extends ValidationError {
    constructor(public readonly missing: string[]) {
        super("Password does not meet the requirements");
    }
}

/**
 * Validates the new password against the same rules as registration,
 * bumps token_version (invalidating every other previously issued
 * session token), revokes every other user_sessions row, records the
 * change in the activity log, then issues a fresh token for *this*
 * session so the caller isn't logged out.
 */
export async function changePassword(
    pool: Pool,
    userId: number,
    currentPassword: string,
    newPassword: string,
    sessionId: number | undefined,
    sessionKey: string,
    ip: string | undefined
): Promise<PasswordChangeResult> {
    const hash = await UserRepository.getPasswordHash(pool, userId);
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
    const newTokenVersion = await UserRepository.updatePassword(pool, userId, newHashedPassword);

    if (sessionId) {
        await UserSessionRepository.revokeAllExcept(pool, userId, sessionId);
    }

    await recordActivity(pool, userId, ActivityAction.PASSWORD_CHANGED, {metadata: {ip}});

    const newToken = appService.createSessionToken(userId, newTokenVersion, sessionKey);
    return {newToken};
}

export async function listSessions(pool: Pool, userId: number, currentSessionId: number | undefined): Promise<Array<UserSession & {isCurrent: boolean}>> {
    const cutoff = new Date(Date.now() - appService.getSessionTime());
    const sessions = await UserSessionRepository.listActive(pool, userId, cutoff);
    return sessions.map((session) => ({...session, isCurrent: session.id === currentSessionId}));
}

/** @returns Whether the revoked session was the caller's own current one (controller clears their cookie if so). */
export async function revokeSession(pool: Pool, userId: number, sessionId: number, ip: string | undefined): Promise<boolean> {
    const revoked = await UserSessionRepository.revoke(pool, sessionId, userId);
    if (!revoked) {
        throw new NotFoundError("Session not found");
    }
    await recordActivity(pool, userId, ActivityAction.LOGOUT, {metadata: {ip, sessionId}});
    return true;
}

export async function listActivity(pool: Pool, userId: number, limit: number): Promise<ActivityLogEntry[]> {
    const cappedLimit = Math.min(limit || 20, 50);
    return UserRepository.listActivity(pool, userId, Object.values(ActivityAction), cappedLimit);
}

export async function acceptSecurityNotice(pool: Pool, userId: number): Promise<void> {
    await UserRepository.acceptSecurityNotice(pool, userId);
}

export async function acceptTermsOfService(pool: Pool, userId: number): Promise<void> {
    await UserRepository.acceptTermsOfService(pool, userId);
}

export async function setupTwoFactor(pool: Pool, userId: number): Promise<TwoFactorSetup> {
    const email = await UserRepository.getEmail(pool, userId);
    if (email === null) {
        throw new NotFoundError("User not found");
    }

    const secret = generateTotpSecret();
    await UserRepository.setTotpSecret(pool, userId, secret);

    const otpauthUrl = buildOtpAuthUrl(email, secret);
    const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUrl);

    return {secret, qrCodeDataUrl};
}

/** Throws ValidationError (400) if setup was never started, UnauthorizedError (401) if the code is wrong. */
export async function enableTwoFactor(pool: Pool, userId: number, code: string): Promise<string[]> {
    const secret = await UserRepository.getTotpSecret(pool, userId);
    if (!secret) {
        throw new ValidationError("Start setup before enabling two-factor authentication.");
    }
    if (!(await verifyTotpCode(secret, String(code).trim()))) {
        throw new UnauthorizedError("Invalid verification code.");
    }

    const backupCodes = generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map((c) => appService.hashPassword(c)));

    // Flip totp_enabled and replace the backup codes as one atomic step -
    // a mid-way failure can't leave 2FA "on" with no valid codes.
    await withTransaction(pool, async (client) => {
        await UserRepository.enableTwoFactor(client, userId);
        await UserRepository.replaceBackupCodes(client, userId, hashedCodes);
    });

    return backupCodes;
}

/** Throws UnauthorizedError (401) if `password` doesn't match. */
export async function disableTwoFactor(pool: Pool, userId: number, password: string): Promise<void> {
    const hash = await UserRepository.getPasswordHash(pool, userId);
    if (!hash || !(await appService.comparePassword(password, hash))) {
        throw new UnauthorizedError("Invalid password.");
    }
    await UserRepository.disableTwoFactor(pool, userId);
    await UserRepository.deleteBackupCodes(pool, userId);
}
