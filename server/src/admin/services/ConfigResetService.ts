/**
 * "Reset all configuration to the environment variables" is the one setting-wide destructive action, so it
 * needs more than a click: a freshly re-verified admin confirms in a dialog, asks for a one-time code, which
 * is emailed to that admin's own address, and types it back. The code is six digits, valid for ten minutes,
 * usable once, tied to the admin who asked for it, and dies after five wrong tries.
 *
 * Codes are kept in memory (hashed): a restart simply invalidates them.
 */
import crypto from "crypto";
import {appService} from "../../AppService";
import {ValidationError} from "../../errors/DomainError";

const VALID_MS = 10 * 60 * 1000;
const RESEND_AFTER_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

interface PendingCode {
    hash: string;
    expiresAt: number;
    requestedAt: number;
    attempts: number;
}

/** @returns "j***@example.com" for "john@example.com". */
export function maskEmail(email: string): string {
    const [name, domain] = email.split("@");
    return `${name.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(name.length - 1, 6)))}@${domain}`;
}

/** Issues and checks the email codes that guard the configuration reset. */
export class ConfigResetService {
    private readonly pending = new Map<number, PendingCode>();
    private readonly salt = crypto.randomBytes(16).toString("hex");

    private hash(adminId: number, code: string): string {
        return crypto.createHash("sha256").update(`${this.salt}:${adminId}:${code}`).digest("hex");
    }

    /**
     * Emails a new code to the admin.
     * @param admin Who asks.
     * @returns The masked address it went to, and when the code expires.
     * @throws ValidationError when email isn't set up, a code was sent a moment ago, or delivery fails.
     */
    public async request(admin: {id: number; email: string}): Promise<{sentTo: string; expiresAt: Date}> {
        const mail = appService.getMailService();
        if (!mail.isEnabled()) {
            throw new ValidationError("Email isn't set up, so a code can't be sent. Set up email first, or run `node index.js config:reset` on the server.");
        }
        const existing = this.pending.get(admin.id);
        if (existing && Date.now() - existing.requestedAt < RESEND_AFTER_MS) {
            throw new ValidationError("A code was just sent. Wait a minute before asking for another.");
        }
        const code = String(crypto.randomInt(100000, 1000000));
        const now = Date.now();
        this.pending.set(admin.id, {hash: this.hash(admin.id, code), expiresAt: now + VALID_MS, requestedAt: now, attempts: 0});
        const error = await mail.sendReportingError(
            admin.email,
            "[Vaultisse] Your code to reset the configuration",
            [
                `Your confirmation code is: ${code}`,
                "",
                "Entering it in the admin console resets every setting saved there, so the environment variables apply again.",
                "It is valid for 10 minutes and works once.",
                "",
                "If you didn't ask for this, ignore this email and consider changing your admin password.",
                "",
                `Instance ${appService.getInstanceUuid()}`,
            ].join("\n")
        );
        if (error !== null) {
            this.pending.delete(admin.id);
            throw new ValidationError(`The code couldn't be emailed: ${error}`);
        }
        return {sentTo: maskEmail(admin.email), expiresAt: new Date(now + VALID_MS)};
    }

    /**
     * Checks (and spends) a code.
     * @param adminId The admin who is confirming.
     * @param code What they typed.
     * @throws ValidationError when there is no valid code, it is wrong, expired, or too many tries were made.
     */
    public verify(adminId: number, code: unknown): void {
        const entry = this.pending.get(adminId);
        if (!entry || Date.now() > entry.expiresAt) {
            this.pending.delete(adminId);
            throw new ValidationError("There is no valid code. Ask for a new one.");
        }
        entry.attempts++;
        const given = Buffer.from(this.hash(adminId, String(code ?? "").trim()));
        const wanted = Buffer.from(entry.hash);
        if (!crypto.timingSafeEqual(given, wanted)) {
            if (entry.attempts >= MAX_ATTEMPTS) {
                this.pending.delete(adminId);
                throw new ValidationError("Too many wrong codes. Ask for a new one.");
            }
            throw new ValidationError(`That code is not right. ${MAX_ATTEMPTS - entry.attempts} ${MAX_ATTEMPTS - entry.attempts === 1 ? "try" : "tries"} left.`);
        }
        this.pending.delete(adminId);
    }
}
