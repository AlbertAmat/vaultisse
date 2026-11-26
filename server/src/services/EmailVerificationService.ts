/**
 * Proves a user owns an email address before it counts: new registrations
 * can't log in until verified, and an email change only applies once the new
 * address confirms it. Links carry a random token; only its hash is stored.
 */
import crypto from "crypto";
import {Pool} from "pg";
import {appService} from "../AppService";
import {EmailVerificationRepository} from "../repositories/EmailVerificationRepository";
import {withTransaction} from "../repositories/withTransaction";
import {ValidationError} from "../errors/DomainError";

/** How long a verification link stays valid. */
const LINK_TTL_HOURS = 24;

/** Minimum time between two links to the same account, so resend can't be used to flood an inbox. */
const RESEND_COOLDOWN_SECONDS = 60;

/** What a confirmed link did. */
export interface VerificationResult {
    kind: "registration" | "emailChange";
    /** The account still needs admin approval before it can log in. */
    requiresApproval: boolean;
}

/** Business rules for email verification. Calls EmailVerificationRepository and MailService. */
export class EmailVerificationService {
    /**
     * @param pool Database connection pool, forwarded to fresh repositories on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Hashes a token for storage/lookup.
     * @param token Raw token from the link.
     * @returns SHA-256 hex.
     */
    private hash(token: string): string {
        return crypto.createHash("sha256").update(token).digest("hex");
    }

    /**
     * Creates and stores a fresh link for a user.
     * @param userId Owning user's id.
     * @param newEmail Address awaiting confirmation, or null for a registration.
     * @returns The absolute link. The token sits in the URL fragment, so it never reaches server or proxy logs.
     */
    private async createLink(userId: number, newEmail: string | null): Promise<string> {
        const token = crypto.randomBytes(32).toString("base64url");
        await new EmailVerificationRepository(this.pool).saveToken(userId, this.hash(token), newEmail, LINK_TTL_HOURS);
        return appService.getMailService().link(`/verify-email#token=${token}`);
    }

    /**
     * Emails a new account its verification link.
     * @param userId New account's id.
     * @param email Its address.
     * @returns Whether the SMTP server accepted the message.
     */
    public async sendRegistrationLink(userId: number, email: string): Promise<boolean> {
        const link = await this.createLink(userId, null);
        // The body deliberately omits the registrant-chosen name: anyone can
        // register with someone else's address, and must not control the text.
        return appService.getMailService().send(email, "Verify your email address",
            `Welcome to Vaultisse.\n\nConfirm your email address to activate your account:\n${link}\n\n` +
            `The link expires in ${LINK_TTL_HOURS} hours. If you didn't create this account, ignore this message.\n`);
    }

    /**
     * Sends a new link to an account still waiting for verification. Silent
     * when there is no such account, so callers can't probe which exist.
     * @param usernameOrEmail Same input as the login form.
     */
    public async resend(usernameOrEmail: string): Promise<void> {
        if (!appService.getMailService().isEnabled()) {
            return;
        }
        const account = await new EmailVerificationRepository(this.pool).findUnverified(usernameOrEmail, RESEND_COOLDOWN_SECONDS);
        if (account && !account.recentlySent) {
            await this.sendRegistrationLink(account.id, account.email);
        }
    }

    /**
     * Starts an email change: the new address gets a confirmation link and the current one stays until it is used.
     * @param userId Owning user's id.
     * @param newEmail Requested address.
     * @throws ValidationError if the address is invalid or unavailable, or the link couldn't be sent.
     */
    public async requestEmailChange(userId: number, newEmail: string): Promise<void> {
        const unavailable = "Unable to use that email address.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 100) {
            throw new ValidationError("Invalid email format.");
        }
        if (await new EmailVerificationRepository(this.pool).emailTaken(userId, newEmail)) {
            throw new ValidationError(unavailable);
        }
        const link = await this.createLink(userId, newEmail);
        const sent = await appService.getMailService().send(newEmail, "Confirm your new email address",
            `Confirm this address for your Vaultisse account:\n${link}\n\n` +
            `The link expires in ${LINK_TTL_HOURS} hours. If you didn't request this, ignore this message.\n`);
        if (!sent) {
            throw new ValidationError("We couldn't send the confirmation email. Please try again later.");
        }
    }

    /**
     * Confirms a link.
     * @param token Raw token from the link.
     * @returns What was confirmed.
     * @throws ValidationError if the link is unknown, used or expired, or the new address was taken meanwhile.
     */
    public async verify(token: string): Promise<VerificationResult> {
        try {
            return await withTransaction(this.pool, async (client) => {
                const repo = new EmailVerificationRepository(client);
                const pending = await repo.consumeToken(this.hash(token));
                if (!pending) {
                    throw new ValidationError("This link is invalid or has expired.");
                }
                if (pending.newEmail !== null) {
                    await repo.applyNewEmail(pending.userId, pending.newEmail);
                    return {kind: "emailChange" as const, requiresApproval: false};
                }
                await repo.markVerified(pending.userId);
                return {kind: "registration" as const, requiresApproval: pending.disabled};
            });
        } catch (err: any) {
            if (err.code === "23505") {
                throw new ValidationError("That email address is no longer available.");
            }
            throw err;
        }
    }
}
