import {Pool} from "pg";
import jwt from "jsonwebtoken";
import {appService} from "../AppService";
import * as AuthRepository from "../repositories/AuthRepository";
import * as OidcRepository from "../repositories/OidcRepository";
import * as OidcUserService from "./OidcUserService";
import {createUserSession} from "../repositories/UserSessionRepository";
import {recordActivity, ActivityAction} from "../repositories/ActivityLogRepository";
import {verifyTotpCode, normalizeBackupCode} from "../utils/TwoFactorAuth";
import {UnauthorizedError, ValidationError} from "../errors/DomainError";

/**
 * Like UserService, imports `appService` directly for JWT/bcrypt
 * operations (comparePassword/hashPassword/createSessionToken/
 * createPending2faToken/verifyPending2faToken/getJwtSecret) bound to its
 * own instance state, rather than treating those as a repository concern.
 */

export type LoginOutcome =
    | {kind: "success"; token: string}
    | {kind: "twoFactorRequired"; pendingToken: string};

export async function login(pool: Pool, usernameOrEmail: string, password: string, userAgent: string | undefined, ip: string | undefined): Promise<LoginOutcome> {
    const candidate = await AuthRepository.findLoginCandidate(pool, usernameOrEmail);
    if (!candidate) {
        appService.getLogger().debug("No user found for:" + usernameOrEmail);
        await recordActivity(pool, null, ActivityAction.LOGIN_FAILED, {metadata: {attemptedUsername: usernameOrEmail, ip}});
        throw new UnauthorizedError("Invalid username or password.");
    }

    if (!(await appService.comparePassword(password, candidate.password))) {
        appService.getLogger().debug("invalid password for user:" + usernameOrEmail);
        await recordActivity(pool, candidate.id, ActivityAction.LOGIN_FAILED, {metadata: {ip}});
        throw new UnauthorizedError("Invalid username or password.");
    }

    if (candidate.totpEnabled) {
        appService.getLogger().debug("Password OK, awaiting 2FA code for user:" + usernameOrEmail);
        const pendingToken = appService.createPending2faToken(candidate.id);
        return {kind: "twoFactorRequired", pendingToken};
    }

    appService.getLogger().debug("Updating last login date for user:" + usernameOrEmail);
    await AuthRepository.updateLastLogin(pool, candidate.id);

    appService.getLogger().debug("Setting session and cookie for user:" + usernameOrEmail);
    const {sessionKey} = await createUserSession(pool, candidate.id, userAgent, ip);
    await recordActivity(pool, candidate.id, ActivityAction.LOGIN, {metadata: {ip}});

    const token = appService.createSessionToken(candidate.id, candidate.tokenVersion, sessionKey);
    appService.getLogger().debug("Redirecting to /app for user:" + usernameOrEmail);
    return {kind: "success", token};
}

/**
 * Checks `code` against `userId`'s unused backup codes; consumes (marks
 * used) and returns true on a match. Codes are hashed with the same
 * bcrypt helper as passwords (see `appService.hashPassword`), so this is a
 * linear scan + compare rather than a direct lookup - fine at the "~10
 * codes per user" scale these are generated at.
 */
async function consumeBackupCode(pool: Pool, userId: number, code: string): Promise<boolean> {
    const codes = await AuthRepository.listUnusedBackupCodes(pool, userId);

    for (const {id, codeHash} of codes) {
        if (await appService.comparePassword(code, codeHash)) {
            await AuthRepository.markBackupCodeUsed(pool, id);
            return true;
        }
    }

    return false;
}

/** Thrown when the pending-2FA cookie is missing/expired, or no longer matches an active 2FA-enabled account - the controller clears the pending cookie in this case (but not on a plain wrong-code UnauthorizedError below, so the user can retry within the same window). */
export class PendingLoginExpiredError extends UnauthorizedError {
}

export async function completeTwoFactorLogin(pool: Pool, pendingToken: string | undefined, code: string, userAgent: string | undefined, ip: string | undefined): Promise<{token: string}> {
    const userId = appService.verifyPending2faToken(pendingToken);
    if (userId === null) {
        throw new PendingLoginExpiredError("Your login has expired. Please log in again.");
    }

    const user = await AuthRepository.findPendingTwoFactorUser(pool, userId);
    if (!user) {
        throw new PendingLoginExpiredError("Your login has expired. Please log in again.");
    }

    const rawCode = String(code).trim();
    let verified = await verifyTotpCode(user.totpSecret, rawCode);
    if (!verified) {
        verified = await consumeBackupCode(pool, user.id, normalizeBackupCode(rawCode));
    }

    if (!verified) {
        await recordActivity(pool, user.id, ActivityAction.LOGIN_FAILED, {metadata: {stage: "2fa", ip}});
        throw new UnauthorizedError("Invalid verification code.");
    }

    await AuthRepository.updateLastLogin(pool, user.id);

    const {sessionKey} = await createUserSession(pool, user.id, userAgent, ip);
    await recordActivity(pool, user.id, ActivityAction.LOGIN, {metadata: {ip}});

    const token = appService.createSessionToken(user.id, user.tokenVersion, sessionKey);
    return {token};
}

export interface RegisterFields {
    userName: string;
    email: string;
    name: string;
    password: string;
}

export async function register(pool: Pool, fields: RegisterFields): Promise<{requiresApproval: boolean}> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(fields.email)) {
        throw new ValidationError("Invalid email format.");
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+[\]{};':"\\|,.<>/?]).{8,}$/;
    if (!passwordRegex.test(fields.password)) {
        throw new ValidationError("Password must be at least 8 characters long and include a number, an uppercase letter, and a special symbol.");
    }

    const hashedPassword = await appService.hashPassword(fields.password);
    const requiresApproval = process.env.REGISTRATION_REQUIRES_APPROVAL === "true";

    try {
        await AuthRepository.register(pool, {
            name: fields.name,
            code: fields.userName,
            email: fields.email,
            passwordHash: hashedPassword,
            disabled: requiresApproval,
        });
    } catch (err: any) {
        if (err.code === "23505") { // PostgreSQL unique violation
            // Deliberately a ValidationError (400), not the usual 409
            // ConflictError mapping used elsewhere - matches the original
            // route exactly. Keeps a duplicate-account response
            // indistinguishable in shape/status from the validation
            // failures above, since confirming that a specific email/
            // username is already registered would let an attacker
            // enumerate existing accounts (CWE-203).
            throw new ValidationError("Unable to register with the provided information.");
        }
        throw err;
    }

    return {requiresApproval};
}

/**
 * Best-effort session revocation for GET /logout: decodes `token` (if any)
 * and revokes the matching `user_sessions` row so it drops off "Active
 * sessions" in Settings and, unlike a plain expiry, can't be replayed even
 * if the cleared cookie somehow survived client-side. An already invalid/
 * expired/missing token is treated as "nothing to revoke", not an error -
 * the controller always clears the cookie and redirects regardless.
 */
export async function logout(pool: Pool, token: string | undefined, ip: string | undefined): Promise<void> {
    if (!token) {
        return;
    }

    try {
        const decoded = jwt.verify(token, appService.getJwtSecret(), {
            algorithms: ["HS256"],
            audience: "vaultisse",
            issuer: "vaultisse.com",
        }) as {user_id: number; sid: string};

        const revoked = await AuthRepository.revokeSessionByKey(pool, decoded.sid, decoded.user_id);
        if (revoked) {
            await recordActivity(pool, decoded.user_id, ActivityAction.LOGOUT, {metadata: {ip}});
        }
    } catch {
        // Already invalid/expired - nothing to revoke.
    }
}

export async function beginSso(): Promise<{url: string; pendingToken: string}> {
    return OidcRepository.beginOidcAuthorization();
}

export async function completeSso(
    pool: Pool,
    query: {code?: string; state?: string; error?: string; error_description?: string},
    pendingCookieToken: string | undefined,
    userAgent: string | undefined,
    ip: string | undefined
): Promise<{token: string}> {
    const claims = await OidcRepository.completeOidcAuthorization(query, pendingCookieToken);
    const user = await OidcUserService.findOrCreateOidcUser(pool, claims);

    await AuthRepository.updateLastLogin(pool, user.id);

    const {sessionKey} = await createUserSession(pool, user.id, userAgent, ip);
    await recordActivity(pool, user.id, ActivityAction.LOGIN, {metadata: {method: "oidc", ip}});

    const token = appService.createSessionToken(user.id, user.tokenVersion, sessionKey);
    return {token};
}
