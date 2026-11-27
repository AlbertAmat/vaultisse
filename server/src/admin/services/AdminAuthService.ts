/**
 * Authentication of admin accounts.
 *
 * Deliberately separate from the regular user login: own table, own JWT audience and signing key (derived
 * from JWT_SECRET but not equal to it), own cookies, own sessions.
 *
 * Flow: password -> (pending cookie, 5 min) -> second factor -> session cookie. Two-factor is mandatory:
 * an admin who hasn't set it up yet is taken through enrolment (secret + QR + confirm a code, which also
 * hands out one-time backup codes) before getting a session. Dangerous actions additionally need a
 * "fresh" verification (password + code again, valid 5 minutes) - see {@link reauthenticate}.
 */
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {Pool} from "pg";
import {ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError} from "../../errors/DomainError";
import {Logger} from "../../utils/Logger";
import {TwoFactorAuth} from "../../utils/TwoFactorAuth";
import {AdminContext} from "../types";
import {
    AdminLoginRow,
    AdminRole,
    AdminUserRepository,
    AdminUserRow,
    hashBackupCode,
} from "../repositories/AdminUserRepository";

const SESSION_AUDIENCE = "vaultisse-admin";
const PENDING_AUDIENCE = "vaultisse-admin-pending";
const ISSUER = "vaultisse.com";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
/** A session unused for this long ends. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** A session ends this long after login no matter how active it is. */
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
/** How long a fresh password+code verification unlocks dangerous actions. */
export const REAUTH_MS = 5 * 60 * 1000;
const BACKUP_CODE_COUNT = 10;

/** Result of the password step. */
export interface PasswordStepResult {
    pendingToken: string;
    /** What the second step is: enter a code, or set two-factor up first. */
    next: "totp" | "enroll";
}

/** Result of completing a login. */
export interface SessionResult {
    token: string;
    admin: AdminUserRow;
}

/** A session resolved from a token. */
export interface ResolvedSession {
    admin: AdminContext;
    /** A fresh token to set when the presented one was close to expiring. */
    refreshedToken: string | null;
}

/** Admin password rules: longer than the user ones, as these accounts can do anything. */
export function validateAdminPassword(password: string): void {
    const problems: string[] = [];
    if (typeof password !== "string" || password.length < 12) problems.push("at least 12 characters");
    if (!/[a-z]/.test(password ?? "")) problems.push("a lowercase letter");
    if (!/[A-Z]/.test(password ?? "")) problems.push("an uppercase letter");
    if (!/[0-9]/.test(password ?? "")) problems.push("a number");
    if (!/[^A-Za-z0-9]/.test(password ?? "")) problems.push("a special character");
    if (problems.length > 0) {
        throw new ValidationError(`The password needs ${problems.join(", ")}.`);
    }
}

/** Login, sessions and account management for admins. */
export class AdminAuthService {
    private readonly repo: AdminUserRepository;
    private readonly signingKey: string;
    private dummyHash: Promise<string> | null = null;

    /**
     * @param pool Database pool.
     * @param logger Server logger.
     * @param jwtSecret The server's JWT secret; the admin signing key is derived from it.
     * @param sessionMs Lifetime of one session token (renewed while in use).
     */
    public constructor(private readonly pool: Pool, private readonly logger: Logger, jwtSecret: string, private readonly sessionMs: number = SESSION_IDLE_MS) {
        this.repo = new AdminUserRepository(pool);
        this.signingKey = crypto.createHmac("sha256", jwtSecret).update("vaultisse-admin-jwt-v1").digest("hex");
    }

    /**
     * Password step of the login.
     * @param email Admin email.
     * @param password Password.
     * @returns A pending token and what the second step is.
     * @throws UnauthorizedError on bad credentials or a locked/disabled account (same message either way).
     */
    public async checkPassword(email: string, password: string): Promise<{result: PasswordStepResult; admin: AdminLoginRow}> {
        const admin = typeof email === "string" && typeof password === "string" ? await this.repo.findForLogin(email.trim()) : null;
        if (!admin) {
            // Same cost as a real check, so timing doesn't reveal which emails exist.
            await bcrypt.compare(String(password ?? ""), await this.getDummyHash());
            throw new UnauthorizedError("Invalid email or password.");
        }
        if (admin.disabled || (admin.lockoutUntil && admin.lockoutUntil.getTime() > Date.now())) {
            await bcrypt.compare(password, await this.getDummyHash());
            throw new UnauthorizedError("Invalid email or password.");
        }
        if (!(await bcrypt.compare(password, admin.password))) {
            await this.repo.recordFailure(admin.id, MAX_FAILED_ATTEMPTS, new Date(Date.now() + LOCKOUT_MS));
            throw new UnauthorizedError("Invalid email or password.");
        }
        const next = admin.totpEnabled ? "totp" : "enroll";
        return {result: {pendingToken: this.createPendingToken(admin.id, next), next}, admin};
    }

    /**
     * Second step for an admin with two-factor on.
     * @param adminId Admin id from the pending token.
     * @param input A 6-digit code or a backup code.
     * @param userAgent Browser.
     * @param ip Client address.
     * @returns The session token.
     * @throws UnauthorizedError on a wrong code.
     */
    public async completeSecondFactor(adminId: number, input: {code?: string; backupCode?: string}, userAgent: string | undefined, ip: string | undefined): Promise<SessionResult> {
        const admin = await this.requireLoginable(adminId);
        if (!admin.totpEnabled || !admin.totpSecret) {
            throw new UnauthorizedError("Two-factor authentication is not set up.");
        }
        await this.verifySecondFactor(admin, input);
        await this.repo.clearFailures(admin.id);
        return this.openSession(admin, userAgent, ip);
    }

    /**
     * Starts two-factor enrolment: creates a secret (not active until confirmed).
     * @param adminId Admin id from the pending token.
     * @returns The secret, its otpauth URL and a QR code.
     */
    public async startEnrollment(adminId: number): Promise<{secret: string; otpauthUrl: string; qrCode: string}> {
        const admin = await this.requireLoginable(adminId);
        if (admin.totpEnabled) {
            throw new ConflictError("Two-factor authentication is already set up.");
        }
        const secret = TwoFactorAuth.generateTotpSecret();
        await this.repo.setTotpSecret(admin.id, secret);
        const otpauthUrl = TwoFactorAuth.buildOtpAuthUrl(admin.email, secret, "Vaultisse Admin");
        return {secret, otpauthUrl, qrCode: await TwoFactorAuth.generateQrCodeDataUrl(otpauthUrl)};
    }

    /**
     * Finishes enrolment by confirming a code, switches two-factor on and opens the session.
     * @param adminId Admin id from the pending token.
     * @param code 6-digit code from the authenticator app.
     * @param userAgent Browser.
     * @param ip Client address.
     * @returns The session token and the one-time backup codes (shown once).
     */
    public async confirmEnrollment(adminId: number, code: string, userAgent: string | undefined, ip: string | undefined): Promise<SessionResult & {backupCodes: string[]}> {
        const admin = await this.requireLoginable(adminId);
        if (admin.totpEnabled || !admin.totpSecret) {
            throw new ConflictError("Start two-factor setup first.");
        }
        const verified = await TwoFactorAuth.verifyTotpCode(admin.totpSecret, String(code ?? ""));
        if (!verified.valid || verified.timeStep === undefined) {
            await this.repo.recordFailure(admin.id, MAX_FAILED_ATTEMPTS, new Date(Date.now() + LOCKOUT_MS));
            throw new UnauthorizedError("That code is not valid.");
        }
        const backupCodes = TwoFactorAuth.generateBackupCodes(BACKUP_CODE_COUNT);
        await this.repo.enableTotp(admin.id, backupCodes.map((backup) => hashBackupCode(backup)), verified.timeStep);
        await this.repo.clearFailures(admin.id);
        const session = await this.openSession({...admin, totpEnabled: true}, userAgent, ip);
        return {...session, backupCodes};
    }

    /**
     * Verifies a TOTP or backup code, counting failures towards the lockout.
     * @private
     */
    private async verifySecondFactor(admin: AdminLoginRow, input: {code?: string; backupCode?: string}): Promise<void> {
        if (admin.lockoutUntil && admin.lockoutUntil.getTime() > Date.now()) {
            throw new UnauthorizedError("Too many failed attempts. Try again later.");
        }
        if (input.backupCode) {
            const used = await this.repo.consumeBackupCode(admin.id, hashBackupCode(TwoFactorAuth.normalizeBackupCode(input.backupCode)));
            if (used) {
                return;
            }
        } else if (input.code && admin.totpSecret) {
            const verified = await TwoFactorAuth.verifyTotpCode(admin.totpSecret, input.code, admin.totpLastUsedStep);
            if (verified.valid && verified.timeStep !== undefined) {
                await this.repo.setTotpStep(admin.id, verified.timeStep);
                return;
            }
        }
        await this.repo.recordFailure(admin.id, MAX_FAILED_ATTEMPTS, new Date(Date.now() + LOCKOUT_MS));
        throw new UnauthorizedError("That code is not valid.");
    }

    private policy: () => {maxAgeDays: number; warnDays: number} = () => ({maxAgeDays: 0, warnDays: 0});

    /** @param policy Where the password lifetime comes from (the portal wires in the settings; without it passwords never expire). */
    public setPasswordPolicy(policy: () => {maxAgeDays: number; warnDays: number}): void {
        this.policy = policy;
    }

    /**
     * Where a password stands against the lifetime policy.
     * @param changedAt When the password was set.
     * @param now Current time (a parameter so it can be tested).
     * @returns When it expires (null = never), whole days left (0 or less once expired), and whether it is expired or inside the warning window.
     * @example
     *   // policy: expire after 60 days, warn from 5 days before; password set 56 days ago
     *   passwordExpiry(setFiftySixDaysAgo)  // {expiresAt: <in 4 days>, daysLeft: 4, expired: false, warning: true}
     *   passwordExpiry(setSixtyOneDaysAgo)  // {expiresAt: <yesterday>, daysLeft: -1, expired: true,  warning: true}
     */
    public passwordExpiry(changedAt: Date, now: number = Date.now()): {expiresAt: Date | null; daysLeft: number | null; expired: boolean; warning: boolean} {
        const {maxAgeDays, warnDays} = this.policy();
        if (maxAgeDays <= 0) {
            return {expiresAt: null, daysLeft: null, expired: false, warning: false};
        }
        const expiresAt = new Date(new Date(changedAt).getTime() + maxAgeDays * 24 * 60 * 60 * 1000);
        const daysLeft = Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000));
        return {expiresAt, daysLeft, expired: expiresAt.getTime() <= now, warning: daysLeft <= warnDays};
    }

    private signInObserver?: (admin: {id: number; email: string}, ip: string | undefined, startedAt: Date) => void;

    /** @param observer Called (without waiting) after every successful admin sign-in. */
    public setSignInObserver(observer: (admin: {id: number; email: string}, ip: string | undefined, startedAt: Date) => void): void {
        this.signInObserver = observer;
    }

    private async openSession(admin: AdminLoginRow, userAgent: string | undefined, ip: string | undefined): Promise<SessionResult> {
        const startedAt = new Date(Date.now() - 1000);
        const {sessionKey} = await this.repo.createSession(admin.id, userAgent, ip);
        await this.repo.touchLastLogin(admin.id);
        this.signInObserver?.({id: admin.id, email: admin.email}, ip, startedAt);
        return {token: this.createSessionToken(admin.id, admin.tokenVersion, sessionKey), admin};
    }

    private async requireLoginable(adminId: number): Promise<AdminLoginRow> {
        const admin = await this.repo.findLoginById(adminId);
        if (!admin || admin.disabled) {
            throw new UnauthorizedError("Invalid login.");
        }
        return admin;
    }

    /**
     * Resolves a session cookie value to the admin it belongs to.
     * @param token The `admin_token` cookie.
     * @returns The admin (and a renewed token when due), or null when the session is invalid, revoked or expired.
     */
    public async resolveSession(token: string | undefined): Promise<ResolvedSession | null> {
        if (!token) {
            return null;
        }
        let decoded: {admin_id: number; token_version: number; sid: string; exp: number};
        try {
            decoded = jwt.verify(token, this.signingKey, {algorithms: ["HS256"], audience: SESSION_AUDIENCE, issuer: ISSUER}) as typeof decoded;
        } catch {
            return null;
        }
        const admin = await this.repo.findById(decoded.admin_id);
        if (!admin || admin.disabled || admin.tokenVersion !== decoded.token_version) {
            return null;
        }
        const session = await this.repo.findActiveSession(decoded.sid, admin.id);
        if (!session) {
            return null;
        }
        const now = Date.now();
        if (now - session.createdDate.getTime() > SESSION_MAX_MS || now - session.lastSeenDate.getTime() > SESSION_IDLE_MS) {
            await this.repo.revokeSession(session.id);
            return null;
        }
        if (now - session.lastSeenDate.getTime() > 60 * 1000) {
            this.repo.touchSession(session.id).catch((error) => this.logger.error(`Updating admin session failed: ${error}`));
        }
        const timeLeft = decoded.exp - Math.floor(now / 1000);
        // A password past its lifetime is treated like a generated one: nothing but changing it works.
        const expiry = this.passwordExpiry(admin.passwordChangedAt);
        return {
            admin: {
                id: admin.id, email: admin.email, name: admin.name, role: admin.role, mustChangePassword: admin.mustChangePassword || expiry.expired, sessionId: session.id, reauthUntil: session.reauthUntil,
                passwordExpired: expiry.expired, passwordExpiresAt: expiry.expiresAt, passwordDaysLeft: expiry.daysLeft, passwordExpiryWarning: expiry.warning,
            },
            refreshedToken: timeLeft < this.sessionMs / 1000 / 2 ? this.createSessionToken(admin.id, admin.tokenVersion, decoded.sid) : null,
        };
    }

    /**
     * Ends one session.
     * @param sessionId Session id.
     */
    public logout(sessionId: number): Promise<void> {
        return this.repo.revokeSession(sessionId);
    }

    /**
     * Fresh verification for dangerous actions: password and a code again.
     * @param admin The signed-in admin.
     * @param password Current password.
     * @param input A 6-digit code or a backup code.
     * @returns When the verification lapses.
     * @throws UnauthorizedError on a wrong password or code.
     */
    public async reauthenticate(admin: AdminContext, password: string, input: {code?: string; backupCode?: string}): Promise<Date> {
        const row = await this.requireLoginable(admin.id);
        if (typeof password !== "string" || !(await bcrypt.compare(password, row.password))) {
            await this.repo.recordFailure(row.id, MAX_FAILED_ATTEMPTS, new Date(Date.now() + LOCKOUT_MS));
            throw new UnauthorizedError("Invalid password.");
        }
        await this.verifySecondFactor(row, input);
        const until = new Date(Date.now() + REAUTH_MS);
        await this.repo.setReauth(admin.sessionId, until);
        return until;
    }

    /**
     * Changes the signed-in admin's password and ends their other sessions.
     * @param admin The signed-in admin.
     * @param currentPassword Current password.
     * @param newPassword New password.
     * @returns A new session token (the old one is invalidated by the token_version bump).
     */
    public async changePassword(admin: AdminContext, currentPassword: string, newPassword: string): Promise<string> {
        const row = await this.requireLoginable(admin.id);
        if (typeof currentPassword !== "string" || !(await bcrypt.compare(currentPassword, row.password))) {
            throw new UnauthorizedError("Invalid current password.");
        }
        validateAdminPassword(newPassword);
        if (newPassword === currentPassword) {
            throw new ValidationError("Choose a password different from the current one.");
        }
        // Changing it back to one of the last five would make the expiry pointless.
        for (const old of row.passwordHistory ?? []) {
            if (await bcrypt.compare(newPassword, old)) {
                throw new ValidationError("You used that password recently. Choose one that isn't among your last five.");
            }
        }
        const sessionKey = await this.sessionKeyOf(admin.sessionId);
        const tokenVersion = await this.repo.setPassword(admin.id, await bcrypt.hash(newPassword, 12));
        // setPassword bumped token_version, so every token (including this one) is stale: end the other
        // sessions and hand back a fresh token for this one.
        await this.repo.revokeOtherSessions(admin.id, admin.sessionId);
        return this.createSessionToken(admin.id, tokenVersion, sessionKey);
    }

    private async sessionKeyOf(sessionId: number): Promise<string> {
        const result = await this.pool.query("SELECT session_key FROM admin_sessions WHERE id = $1", [sessionId]);
        return result.rows[0]?.session_key ?? "";
    }

    /** @returns Every admin account. */
    public list(): Promise<AdminUserRow[]> {
        return this.repo.list();
    }

    /**
     * Creates an admin account. The new admin sets up two-factor at first login.
     * @param fields Email, name, initial password and role.
     * @returns The new admin.
     * @throws ValidationError / ConflictError on bad input or a duplicate email.
     */
    public async create(fields: {email: string; name: string; password: string; role: AdminRole; mustChangePassword?: boolean}): Promise<AdminUserRow> {
        const email = String(fields.email ?? "").trim();
        const name = String(fields.name ?? "").trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 100) {
            throw new ValidationError("Enter a valid email address.");
        }
        if (!name || name.length > 100) {
            throw new ValidationError("Enter a name.");
        }
        if (fields.role !== "superadmin" && fields.role !== "readonly") {
            throw new ValidationError("Role must be superadmin or readonly.");
        }
        validateAdminPassword(fields.password);
        try {
            const id = await this.repo.create({email, name, passwordHash: await bcrypt.hash(fields.password, 12), role: fields.role, mustChangePassword: fields.mustChangePassword});
            return (await this.repo.findById(id))!;
        } catch (error: any) {
            if (error?.code === "23505") {
                throw new ConflictError("An admin with that email already exists.");
            }
            throw error;
        }
    }

    /**
     * Changes another admin's role or disabled state.
     * @param actor The admin doing it.
     * @param id Target admin id.
     * @param fields Changes.
     * @returns The updated admin.
     */
    public async update(actor: AdminContext, id: number, fields: {role?: AdminRole; disabled?: boolean}): Promise<AdminUserRow> {
        const target = await this.repo.findById(id);
        if (!target) {
            throw new NotFoundError("Admin not found.");
        }
        if (fields.role !== undefined && fields.role !== "superadmin" && fields.role !== "readonly") {
            throw new ValidationError("Role must be superadmin or readonly.");
        }
        const losesPower = (fields.role === "readonly" && target.role === "superadmin") || fields.disabled === true;
        if (losesPower && id === actor.id) {
            throw new ForbiddenError("You can't lock yourself out. Ask another superadmin.");
        }
        if (losesPower && target.role === "superadmin" && !target.disabled && (await this.repo.countActiveSuperadmins()) <= 1) {
            throw new ConflictError("This is the last active superadmin.");
        }
        await this.repo.update(id, fields);
        return (await this.repo.findById(id))!;
    }

    /**
     * Removes another admin's two-factor so they enrol again (lost phone).
     * @param id Target admin id.
     */
    public async resetTwoFactor(id: number): Promise<AdminUserRow> {
        const target = await this.repo.findById(id);
        if (!target) {
            throw new NotFoundError("Admin not found.");
        }
        await this.repo.resetTotp(id);
        return (await this.repo.findById(id))!;
    }

    /**
     * Deletes another admin.
     * @param actor The admin doing it.
     * @param id Target admin id.
     */
    public async remove(actor: AdminContext, id: number): Promise<AdminUserRow> {
        if (id === actor.id) {
            throw new ForbiddenError("You can't delete your own account.");
        }
        const target = await this.repo.findById(id);
        if (!target) {
            throw new NotFoundError("Admin not found.");
        }
        if (target.role === "superadmin" && !target.disabled && (await this.repo.countActiveSuperadmins()) <= 1) {
            throw new ConflictError("This is the last active superadmin.");
        }
        await this.repo.delete(id);
        return target;
    }

    /**
     * First start with the portal on and no admin yet: creates one with a generated password that must be
     * changed at first login. Called once at start-up; does nothing when any admin exists.
     * @returns The new admin's login, or null when an admin already existed.
     */
    public async bootstrapFirstAdmin(): Promise<{email: string; password: string} | null> {
        if ((await this.repo.count()) > 0) {
            return null;
        }
        // 20 characters from an unambiguous alphabet, with one of each class so the password rules always hold.
        const pick = (chars: string) => chars[crypto.randomInt(chars.length)];
        const classes = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%^&*-_=+"];
        const all = classes.join("");
        const chars = [...classes.map(pick), ...Array.from({length: 16}, () => pick(all))];
        for (let i = chars.length - 1; i > 0; i--) {
            const j = crypto.randomInt(i + 1);
            [chars[i], chars[j]] = [chars[j], chars[i]];
        }
        const password = chars.join("");
        const email = "admin@vaultisse.local";
        try {
            await this.create({email, name: "Administrator", password, role: "superadmin", mustChangePassword: true});
        } catch (error) {
            if (error instanceof ConflictError) {
                return null;
            }
            throw error;
        }
        return {email, password};
    }

    /**
     * Command-line helper: creates an admin or, if the email exists, resets its password and two-factor.
     * @param fields Email, name and password.
     * @returns Whether the account was created (true) or reset (false).
     */
    public async createOrReset(fields: {email: string; name: string; password: string}): Promise<boolean> {
        validateAdminPassword(fields.password);
        const existing = await this.repo.findForLogin(fields.email);
        if (!existing) {
            await this.create({...fields, role: "superadmin"});
            return true;
        }
        await this.repo.setPassword(existing.id, await bcrypt.hash(fields.password, 12));
        await this.repo.resetTotp(existing.id);
        await this.repo.update(existing.id, {disabled: false});
        return false;
    }

    /**
     * @param token The `admin_pending` cookie.
     * @returns The admin id and which step it allows, or null if invalid/expired.
     */
    public verifyPendingToken(token: string | undefined): {adminId: number; stage: "totp" | "enroll"} | null {
        if (!token) {
            return null;
        }
        try {
            const decoded = jwt.verify(token, this.signingKey, {algorithms: ["HS256"], audience: PENDING_AUDIENCE, issuer: ISSUER}) as {admin_id: number; stage: "totp" | "enroll"};
            return {adminId: decoded.admin_id, stage: decoded.stage};
        } catch {
            return null;
        }
    }

    /** Deletes expired sessions. */
    public purgeSessions(): Promise<void> {
        return this.repo.purgeSessions(new Date(Date.now() - 2 * SESSION_MAX_MS));
    }

    private createSessionToken(adminId: number, tokenVersion: number, sessionKey: string): string {
        return jwt.sign({admin_id: adminId, token_version: tokenVersion, sid: sessionKey}, this.signingKey, {
            expiresIn: Math.floor(this.sessionMs / 1000),
            audience: SESSION_AUDIENCE,
            issuer: ISSUER,
        });
    }

    private createPendingToken(adminId: number, stage: "totp" | "enroll"): string {
        return jwt.sign({admin_id: adminId, stage}, this.signingKey, {expiresIn: 5 * 60, audience: PENDING_AUDIENCE, issuer: ISSUER});
    }

    private getDummyHash(): Promise<string> {
        this.dummyHash ??= bcrypt.hash(crypto.randomBytes(16).toString("hex"), 12);
        return this.dummyHash;
    }
}

