import {Pool} from "pg";
import jwt from "jsonwebtoken";
import {appService} from "../AppService";
import {AuthRepository} from "../repositories/AuthRepository";
import {OidcRepository} from "../repositories/OidcRepository";
import {OidcUserService} from "./OidcUserService";
import {UserSessionRepository} from "../repositories/UserSessionRepository";
import {ActivityLogRepository, ActivityAction} from "../repositories/ActivityLogRepository";
import {TwoFactorAuth} from "../utils/TwoFactorAuth";
import {UnauthorizedError, ValidationError} from "../errors/DomainError";

export type LoginOutcome =
    | {kind: "success"; token: string}
    | {kind: "twoFactorRequired"; pendingToken: string};

/** Consecutive wrong passwords allowed before an account is locked out of POST /login (security audit #5). */
const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/** Consecutive wrong 2FA codes allowed before an account's pending login is locked out of POST /login/2fa (security audit #5). */
const MAX_FAILED_TOTP_ATTEMPTS = 5;

/** How long an account stays locked out after crossing either threshold above - matches the per-IP rate limiters' own "try again after 15 minutes" wording (see AuthRoute.ts). */
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * Fixed bcrypt hash (cost 12, matching appService.hashPassword) of a
 * password nobody has. Compared against whenever no account matches the
 * login attempt, so that path costs the same bcrypt work a real
 * wrong-password check would - without this, response time alone reveals
 * whether a username/email is registered (security audit #10).
 */
const DUMMY_PASSWORD_HASH = "$2b$12$JBpLRwvJEpRaodWGua89..FDpxEcAU4UiPhCwBrPRpGpG.GPkyLGC";

export interface RegisterFields {
    userName: string;
    email: string;
    name: string;
    password: string;
}

/** Thrown when the pending-2FA cookie is missing/expired, or no longer matches an active 2FA-enabled account - the controller clears the pending cookie in this case (but not on a plain wrong-code UnauthorizedError below, so the user can retry within the same window). */
export class PendingLoginExpiredError extends UnauthorizedError {
}

/**
 * Business rules for the Auth resource: password login/2FA/register/logout
 * and the OIDC/SSO flow. Calls AuthRepository/UserSessionRepository/
 * ActivityLogRepository (+ OidcRepository/OidcUserService for SSO); throws
 * DomainError subclasses for expected failures.
 *
 * Like UserService, imports `appService` directly for JWT/bcrypt
 * operations (comparePassword/hashPassword/createSessionToken/
 * createPending2faToken/verifyPending2faToken/getJwtSecret) bound to its
 * own instance state, rather than treating those as a repository concern.
 */
export class AuthService {
    /**
     * @param pool Database connection pool, forwarded to fresh repositories/services on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Authenticates with username/email + password. If the account has 2FA
     * enabled, only verifies the password and returns a pending-2FA token
     * instead of a session.
     *
     * @param usernameOrEmail Either the user's code or email.
     * @param password Plaintext password.
     * @param userAgent Request `User-Agent` header, if any.
     * @param ip Request client IP, if any.
     * @returns Either a full session token, or a pending-2FA token.
     * @throws UnauthorizedError (401) on invalid credentials.
     */
    public async login(usernameOrEmail: string, password: string, userAgent: string | undefined, ip: string | undefined): Promise<LoginOutcome> {
        const authRepo = new AuthRepository(this.pool);
        const candidate = await authRepo.findLoginCandidate(usernameOrEmail);
        if (!candidate) {
            appService.getLogger().debug("No user found for:" + usernameOrEmail);
            // Timing-safe (security audit #10): pay the same bcrypt cost a
            // real wrong-password check would below, so response time
            // doesn't leak whether this username/email is registered.
            await appService.comparePassword(password, DUMMY_PASSWORD_HASH);
            await new ActivityLogRepository(this.pool).recordActivity(null, ActivityAction.LOGIN_FAILED, {metadata: {attemptedUsername: usernameOrEmail, ip}});
            throw new UnauthorizedError("Invalid username or password.");
        }

        // Per-account lockout (security audit #5): the per-IP rate limiter
        // in AuthRoute.ts doesn't slow down credential stuffing spread
        // across many source IPs. Checked before the password comparison so
        // a locked-out account doesn't keep paying bcrypt's cost either.
        if (candidate.lockoutUntil && candidate.lockoutUntil.getTime() > Date.now()) {
            appService.getLogger().debug("Account locked out, rejecting login for:" + usernameOrEmail);
            await new ActivityLogRepository(this.pool).recordActivity(candidate.id, ActivityAction.LOGIN_FAILED, {metadata: {ip, reason: "locked"}});
            throw new UnauthorizedError("Too many failed attempts. Please try again later.");
        }

        if (!(await appService.comparePassword(password, candidate.password))) {
            appService.getLogger().debug("invalid password for user:" + usernameOrEmail);
            await authRepo.recordFailedLoginAttempt(candidate.id, MAX_FAILED_LOGIN_ATTEMPTS, new Date(Date.now() + LOCKOUT_DURATION_MS));
            await new ActivityLogRepository(this.pool).recordActivity(candidate.id, ActivityAction.LOGIN_FAILED, {metadata: {ip}});
            throw new UnauthorizedError("Invalid username or password.");
        }

        // Correct password - clear the password-lockout counter. The
        // separate 2FA-lockout counter (if any) is untouched here, so
        // knowing the password can't be used to reset an in-progress 2FA
        // lockout (security audit #5).
        await authRepo.resetFailedLoginAttempts(candidate.id);

        if (candidate.totpEnabled) {
            appService.getLogger().debug("Password OK, awaiting 2FA code for user:" + usernameOrEmail);
            const pendingToken = appService.createPending2faToken(candidate.id);
            return {kind: "twoFactorRequired", pendingToken};
        }

        appService.getLogger().debug("Updating last login date for user:" + usernameOrEmail);
        await authRepo.updateLastLogin(candidate.id);

        appService.getLogger().debug("Setting session and cookie for user:" + usernameOrEmail);
        const {sessionKey} = await new UserSessionRepository(this.pool).createUserSession(candidate.id, userAgent, ip);
        await new ActivityLogRepository(this.pool).recordActivity(candidate.id, ActivityAction.LOGIN, {metadata: {ip}});

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
     *
     * @param userId Owning user's id.
     * @param code Normalized backup code to check.
     * @returns Whether a matching, unused backup code was found (and consumed).
     */
    private async consumeBackupCode(userId: number, code: string): Promise<boolean> {
        const authRepo = new AuthRepository(this.pool);
        const codes = await authRepo.listUnusedBackupCodes(userId);

        for (const {id, codeHash} of codes) {
            if (await appService.comparePassword(code, codeHash)) {
                await authRepo.markBackupCodeUsed(id);
                return true;
            }
        }

        return false;
    }

    /**
     * Completes the second step of login for a 2FA-enabled account: verifies a TOTP or backup code, then issues the real session.
     * @param pendingToken Raw `pending_2fa_token` cookie value.
     * @param code Verification code (6-digit TOTP, or an "XXXXXXXX-XXXXXXXX" backup code).
     * @param userAgent Request `User-Agent` header, if any.
     * @param ip Request client IP, if any.
     * @returns The full session token.
     * @throws PendingLoginExpiredError if the pending cookie is missing/invalid/expired, UnauthorizedError (401) if the code is wrong.
     */
    public async completeTwoFactorLogin(pendingToken: string | undefined, code: string, userAgent: string | undefined, ip: string | undefined): Promise<{token: string}> {
        const userId = appService.verifyPending2faToken(pendingToken);
        if (userId === null) {
            throw new PendingLoginExpiredError("Your login has expired. Please log in again.");
        }

        const authRepo = new AuthRepository(this.pool);
        const user = await authRepo.findPendingTwoFactorUser(userId);
        if (!user) {
            throw new PendingLoginExpiredError("Your login has expired. Please log in again.");
        }

        // Per-pending-login 2FA lockout (security audit #5): without this,
        // the pending_2fa_token stays valid for its whole 5-minute window no
        // matter how many codes are tried, and the per-IP rate limiter in
        // AuthRoute.ts doesn't stop an attacker who already knows the
        // password from just switching IPs. Forcing a fresh /login here
        // (rather than just a 401) also means a fresh password check.
        if (user.totpLockoutUntil && user.totpLockoutUntil.getTime() > Date.now()) {
            await new ActivityLogRepository(this.pool).recordActivity(user.id, ActivityAction.LOGIN_FAILED, {metadata: {stage: "2fa", ip, reason: "locked"}});
            throw new PendingLoginExpiredError("Too many failed attempts. Please log in again.");
        }

        const rawCode = String(code).trim();
        // afterTimeStep rejects a code that's already been accepted once,
        // stopping the exact same 6-digit code from being replayed a second
        // time inside its ~30s validity window (security audit #5).
        const totpResult = await TwoFactorAuth.verifyTotpCode(user.totpSecret, rawCode, user.totpLastUsedStep);
        let verified = totpResult.valid;
        if (verified && totpResult.timeStep !== undefined) {
            await authRepo.setTotpLastUsedStep(user.id, totpResult.timeStep);
        }
        if (!verified) {
            verified = await this.consumeBackupCode(user.id, TwoFactorAuth.normalizeBackupCode(rawCode));
        }

        if (!verified) {
            await authRepo.recordFailedTwoFactorAttempt(user.id, MAX_FAILED_TOTP_ATTEMPTS, new Date(Date.now() + LOCKOUT_DURATION_MS));
            await new ActivityLogRepository(this.pool).recordActivity(user.id, ActivityAction.LOGIN_FAILED, {metadata: {stage: "2fa", ip}});
            throw new UnauthorizedError("Invalid verification code.");
        }

        await authRepo.resetTwoFactorFailures(user.id);
        await authRepo.updateLastLogin(user.id);

        const {sessionKey} = await new UserSessionRepository(this.pool).createUserSession(user.id, userAgent, ip);
        await new ActivityLogRepository(this.pool).recordActivity(user.id, ActivityAction.LOGIN, {metadata: {ip}});

        const token = appService.createSessionToken(user.id, user.tokenVersion, sessionKey);
        return {token};
    }

    /**
     * Registers a new user account.
     * @param fields Registration fields.
     * @returns Whether the account requires admin approval before it can log in.
     * @throws ValidationError (400) on invalid email/weak password, or a duplicate email/code (deliberately mapped to 400, not 409 - see the CWE-203 note below).
     */
    public async register(fields: RegisterFields): Promise<{requiresApproval: boolean}> {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(fields.email)) {
            throw new ValidationError("Invalid email format.");
        }

        // Usernames that look like an email address are confusing and
        // pointless to allow now that AuthRepository.findLoginCandidate
        // matches email-shaped login input against the email column only
        // (the actual fix for security audit #7's account-shadowing risk) -
        // such a username could never be used to log in anyway.
        if (fields.userName.includes("@")) {
            throw new ValidationError("Username cannot contain \"@\".");
        }

        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+[\]{};':"\\|,.<>/?]).{8,}$/;
        if (!passwordRegex.test(fields.password)) {
            throw new ValidationError("Password must be at least 8 characters long and include a number, an uppercase letter, and a special symbol.");
        }

        const hashedPassword = await appService.hashPassword(fields.password);
        const requiresApproval = process.env.REGISTRATION_REQUIRES_APPROVAL === "true";

        try {
            await new AuthRepository(this.pool).register({
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
     *
     * @param token Raw `token` session cookie value, if any.
     * @param ip Request client IP, if any.
     */
    public async logout(token: string | undefined, ip: string | undefined): Promise<void> {
        if (!token) {
            return;
        }

        try {
            const decoded = jwt.verify(token, appService.getJwtSecret(), {
                algorithms: ["HS256"],
                audience: "vaultisse",
                issuer: "vaultisse.com",
            }) as {user_id: number; sid: string};

            const revoked = await new AuthRepository(this.pool).revokeSessionByKey(decoded.sid, decoded.user_id);
            if (revoked) {
                await new ActivityLogRepository(this.pool).recordActivity(decoded.user_id, ActivityAction.LOGOUT, {metadata: {ip}});
            }
        } catch {
            // Already invalid/expired - nothing to revoke.
        }
    }

    /**
     * Begins the OIDC authorization-code + PKCE flow.
     * @returns The IdP authorize URL and the signed pending-cookie value.
     */
    public async beginSso(): Promise<{url: string; pendingToken: string}> {
        return OidcRepository.beginOidcAuthorization();
    }

    /**
     * Completes the OIDC callback: exchanges the code, finds/links/JIT-creates the user, and issues a session.
     * @param query Callback query params (code/state, or an IdP-reported error).
     * @param pendingCookieToken Raw `oidc_pending` cookie value.
     * @param userAgent Request `User-Agent` header, if any.
     * @param ip Request client IP, if any.
     * @returns The full session token.
     */
    public async completeSso(
        query: {code?: string; state?: string; error?: string; error_description?: string},
        pendingCookieToken: string | undefined,
        userAgent: string | undefined,
        ip: string | undefined
    ): Promise<{token: string}> {
        const claims = await OidcRepository.completeOidcAuthorization(query, pendingCookieToken);
        const user = await new OidcUserService(this.pool).findOrCreateOidcUser(claims);

        const authRepo = new AuthRepository(this.pool);
        await authRepo.updateLastLogin(user.id);

        const {sessionKey} = await new UserSessionRepository(this.pool).createUserSession(user.id, userAgent, ip);
        await new ActivityLogRepository(this.pool).recordActivity(user.id, ActivityAction.LOGIN, {metadata: {method: "oidc", ip}});

        const token = appService.createSessionToken(user.id, user.tokenVersion, sessionKey);
        return {token};
    }
}
