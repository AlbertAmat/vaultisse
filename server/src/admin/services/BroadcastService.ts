/**
 * Emails an announcement to the users of the app: "the library will be offline Saturday", "new terms".
 *
 * An admin writes a subject and a message, picks who gets it, previews it (exact recipient count, a sample
 * of addresses, the email as it will look) and sends. Sending runs in the background at a gentle pace
 * (so the mail server isn't flooded) and can be cancelled; the history shows the final counts. Only accounts
 * that can actually receive mail are ever addressed: enabled, with a verified address.
 *
 * `{name}` in the subject or message is replaced by each person's name.
 */
import {Pool} from "pg";
import {appService} from "../../AppService";
import {ConflictError, NotFoundError, ValidationError} from "../../errors/DomainError";
import {Logger} from "../../utils/Logger";
import {maskEmail} from "./ConfigResetService";

export type Audience = "all" | "vault_admins" | "active_30" | "no_two_factor";

export const AUDIENCES: {value: Audience; label: string; description: string}[] = [
    {value: "all", label: "Everyone", description: "Every enabled account with a verified email."},
    {value: "vault_admins", label: "Vault admins", description: "People who administer at least one vault."},
    {value: "active_30", label: "Active in the last 30 days", description: "Accounts that signed in or were used recently."},
    {value: "no_two_factor", label: "Without two-factor", description: "Accounts that haven't set up two-factor authentication."},
];

const AUDIENCE_SQL: Record<Audience, string> = {
    all: "TRUE",
    vault_admins: "EXISTS (SELECT 1 FROM vault_users vu WHERE vu.user_id = u.id AND vu.role = 1 AND vu.status = 1)",
    active_30: "GREATEST(u.last_login_date::timestamptz, u.last_activity_date, (SELECT MAX(s.last_seen_date) FROM user_sessions s WHERE s.user_id = u.id)) > NOW() - INTERVAL '30 days'",
    no_two_factor: "u.totp_enabled = FALSE",
};

export interface Recipient {
    id: number;
    name: string;
    email: string;
}

export interface BroadcastRow {
    id: number;
    subject: string;
    body: string;
    audience: string;
    recipients: number;
    sent: number;
    failed: number;
    status: "sending" | "done" | "cancelled" | "interrupted";
    createdBy: string | null;
    createdDate: Date;
    finishedAt: Date | null;
}

const MAX_SUBJECT = 200;
const MAX_BODY = 10000;
/** Pause between two emails. */
const PACE_MS = 120;

/** Composes, previews and sends broadcasts. */
export class BroadcastService {
    private readonly cancelled = new Set<number>();
    /** Overridable pause between emails (tests set it to 0). */
    public paceMs = PACE_MS;

    /**
     * @param pool Database pool.
     * @param logger Server logger.
     */
    public constructor(private readonly pool: Pool, private readonly logger: Logger) {
    }

    /**
     * @param audience Who.
     * @returns The accounts that would receive it.
     * @throws ValidationError for an unknown audience.
     */
    public async recipients(audience: string): Promise<Recipient[]> {
        if (!(audience in AUDIENCE_SQL)) {
            throw new ValidationError("Unknown audience.");
        }
        const result = await this.pool.query(
            `SELECT u.id, u.name, u.email FROM users u
              WHERE u.disabled = FALSE AND u.email_verified = TRUE AND u.email <> '' AND (${AUDIENCE_SQL[audience as Audience]})
              ORDER BY u.id`
        );
        return result.rows;
    }

    /**
     * Checks and normalises what the admin wrote.
     * @param subject Subject line.
     * @param body Message.
     * @returns The cleaned subject and body.
     */
    public static validate(subject: unknown, body: unknown): {subject: string; body: string} {
        const cleanSubject = typeof subject === "string" ? subject.replace(/[\r\n]+/g, " ").trim() : "";
        const cleanBody = typeof body === "string" ? body.replace(/\r\n/g, "\n").trim() : "";
        if (!cleanSubject || cleanSubject.length > MAX_SUBJECT) {
            throw new ValidationError(`Write a subject of up to ${MAX_SUBJECT} characters.`);
        }
        if (!cleanBody || cleanBody.length > MAX_BODY) {
            throw new ValidationError(`Write a message of up to ${MAX_BODY} characters.`);
        }
        return {subject: cleanSubject, body: cleanBody};
    }

    /**
     * @param subject Subject template.
     * @param body Message template.
     * @param name Recipient's name.
     * @returns The email exactly as that person receives it.
     */
    public static render(subject: string, body: string, name: string): {subject: string; text: string} {
        const fill = (text: string) => text.replace(/\{name\}/g, name);
        const site = (process.env.FRONT_END_URL ?? "").replace(/\/+$/, "");
        return {
            subject: fill(subject),
            text: `${fill(body)}\n\n--\nThis is a service message about your Vaultisse account${site ? ` on ${site}` : ""}.`,
        };
    }

    /**
     * Counts recipients and builds a sample, without sending anything.
     * @param audience Who.
     * @param subject Subject template.
     * @param body Message template.
     * @param sampleName Name shown for `{name}` in the sample (the admin's own).
     * @returns Count, a few masked addresses and the email as it will read.
     */
    public async preview(audience: string, subject: string, body: string, sampleName: string) {
        const recipients = await this.recipients(audience);
        const email = BroadcastService.render(subject, body, sampleName);
        return {
            count: recipients.length,
            sample: recipients.slice(0, 5).map((r) => maskEmail(r.email)),
            email,
            mailEnabled: appService.getMailService().isEnabled(),
        };
    }

    /**
     * Sends the email to one address only (the admin), to see it for real.
     * @param to Address.
     * @param name Name used for `{name}`.
     * @returns null when accepted, otherwise why not.
     */
    public async sendTest(to: string, name: string, subject: string, body: string): Promise<string | null> {
        const mail = appService.getMailService();
        if (!mail.isEnabled()) {
            throw new ValidationError("Email isn't set up, so nothing can be sent. Set it up under Settings first.");
        }
        const email = BroadcastService.render(`[Test] ${subject}`, body, name);
        return mail.sendReportingError(to, email.subject, email.text);
    }

    /**
     * Starts sending. Returns as soon as the broadcast is recorded; the sending itself continues in the background.
     * @param adminId Who sends it.
     * @param audience Who gets it.
     * @param subject Subject template.
     * @param body Message template.
     * @param expectedCount The recipient count the admin saw in the preview; must still be right.
     * @returns The recorded broadcast.
     * @throws ValidationError / ConflictError (another one is still sending, or the audience changed meanwhile).
     */
    public async send(adminId: number, audience: string, subject: string, body: string, expectedCount: number): Promise<BroadcastRow> {
        if (!appService.getMailService().isEnabled()) {
            throw new ValidationError("Email isn't set up, so nothing can be sent. Set it up under Settings first.");
        }
        const open = await this.pool.query("SELECT 1 FROM broadcasts WHERE status = 'sending' LIMIT 1");
        if ((open.rowCount ?? 0) > 0) {
            throw new ConflictError("Another broadcast is still being sent. Wait for it to finish, or cancel it.");
        }
        const recipients = await this.recipients(audience);
        if (recipients.length === 0) {
            throw new ValidationError("Nobody matches this audience.");
        }
        if (recipients.length !== expectedCount) {
            throw new ConflictError(`The audience changed: it is now ${recipients.length} people instead of ${expectedCount}. Preview again.`);
        }
        const created = await this.pool.query(
            "INSERT INTO broadcasts (subject, body, audience, recipients, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [subject, body, audience, recipients.length, adminId]
        );
        const id = created.rows[0].id as number;
        void this.run(id, recipients, subject, body);
        return (await this.find(id))!;
    }

    private async run(id: number, recipients: Recipient[], subject: string, body: string): Promise<void> {
        const mail = appService.getMailService();
        let sent = 0;
        let failed = 0;
        let status: "done" | "cancelled" = "done";
        try {
            for (const [index, recipient] of recipients.entries()) {
                if (this.cancelled.has(id)) {
                    status = "cancelled";
                    break;
                }
                const email = BroadcastService.render(subject, body, recipient.name);
                if (await mail.send(recipient.email, email.subject, email.text)) {
                    sent++;
                } else {
                    failed++;
                }
                if ((index + 1) % 5 === 0) {
                    await this.pool.query("UPDATE broadcasts SET sent = $2, failed = $3 WHERE id = $1", [id, sent, failed]);
                }
                if (this.paceMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, this.paceMs));
                }
            }
        } catch (error) {
            this.logger.error(`Broadcast ${id} stopped: ${error instanceof Error ? error.message : String(error)}`);
            status = "cancelled";
        } finally {
            this.cancelled.delete(id);
            await this.pool.query("UPDATE broadcasts SET sent = $2, failed = $3, status = $4, finished_at = CURRENT_TIMESTAMP WHERE id = $1", [id, sent, failed, status])
                .catch((error) => this.logger.error(`Saving broadcast ${id} failed: ${error}`));
        }
    }

    /**
     * Stops a broadcast that is still sending (what was already sent stays sent).
     * @param id Broadcast id.
     */
    public async cancel(id: number): Promise<BroadcastRow> {
        const row = await this.find(id);
        if (!row) {
            throw new NotFoundError("Broadcast not found.");
        }
        if (row.status !== "sending") {
            throw new ConflictError("This broadcast has already finished.");
        }
        this.cancelled.add(id);
        return row;
    }

    /** Marks broadcasts that were still sending when the server stopped as interrupted. Called at start-up. */
    public async markInterrupted(): Promise<void> {
        await this.pool.query("UPDATE broadcasts SET status = 'interrupted', finished_at = CURRENT_TIMESTAMP WHERE status = 'sending'");
    }

    /**
     * @param id Broadcast id.
     * @returns The broadcast, or null.
     */
    public async find(id: number): Promise<BroadcastRow | null> {
        const result = await this.pool.query(`${BroadcastService.SELECT} WHERE b.id = $1`, [id]);
        return result.rows[0] ?? null;
    }

    /**
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of the history, newest first, and the total.
     */
    public async list(limit: number, offset: number): Promise<{rows: BroadcastRow[]; total: number}> {
        const total = await this.pool.query("SELECT COUNT(*)::int AS total FROM broadcasts");
        const rows = await this.pool.query(`${BroadcastService.SELECT} ORDER BY b.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
        return {rows: rows.rows, total: total.rows[0].total};
    }

    private static readonly SELECT = `SELECT b.id, b.subject, b.body, b.audience, b.recipients, b.sent, b.failed, b.status,
                                             a.email AS "createdBy", b.created_date AS "createdDate", b.finished_at AS "finishedAt"
                                        FROM broadcasts b LEFT JOIN admin_users a ON a.id = b.created_by`;
}
