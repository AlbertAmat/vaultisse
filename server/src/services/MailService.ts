/**
 * Outgoing mail over SMTP. Mail is optional: with no SMTP_* configuration
 * the service is disabled, nothing is ever sent, and the features that
 * depend on it (email verification, notifications) switch off.
 */
import nodemailer, {Transporter} from "nodemailer";
import {Logger} from "../utils/Logger";

/** Resolved SMTP settings - see MailService.readConfig. */
export interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    requireTls: boolean;
    user: string | undefined;
    password: string;
    from: string;
    /** Public origin used to build the links inside emails (FRONT_END_URL, no trailing slash). */
    publicUrl: string;
}

/** Told about every delivery attempt (recipient, subject, outcome) - the admin portal's sent-mail log. Never gets the body. */
export type MailRecorder = (entry: {to: string; subject: string; error: string | null}) => void;

/** Sends plain-text mail through the configured SMTP server, or does nothing when there is none. */
export class MailService {
    private transporter: Transporter | null = null;
    private config: SmtpConfig | null = null;
    private recorder: MailRecorder | null = null;

    /**
     * @param config SMTP settings, or null to disable mail.
     * @param logger Server logger, for delivery failures.
     */
    public constructor(config: SmtpConfig | null, private readonly logger: Logger) {
        this.reconfigure(config);
    }

    /** @param recorder Callback told about every delivery attempt, or null. */
    public setRecorder(recorder: MailRecorder | null): void {
        this.recorder = recorder;
    }

    /** @returns The current delivery recorder. */
    public getRecorder(): MailRecorder | null {
        return this.recorder;
    }

    /**
     * Switches to new SMTP settings without recreating the service, so callers holding it
     * (and the admin portal's "save") take effect immediately.
     * @param config New settings, or null to disable mail.
     */
    public reconfigure(config: SmtpConfig | null): void {
        this.config = config;
        this.transporter = config === null ? null : nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            requireTLS: config.requireTls,
            auth: config.user ? {user: config.user, pass: config.password} : undefined,
            // A request (register, resend) waits on delivery - don't let an unreachable server hang it.
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 20000,
        });
    }

    /**
     * Reads the SMTP settings from the environment.
     * @param env Environment variables.
     * @returns The settings, or null when neither SMTP_HOST nor SMTP_FROM is set.
     * @throws Error on a half-configured setup, so a typo can't silently turn email verification off.
     */
    public static readConfig(env: NodeJS.ProcessEnv): SmtpConfig | null {
        const host = (env.SMTP_HOST ?? "").trim();
        const from = (env.SMTP_FROM ?? "").trim();
        if (!host && !from) {
            return null;
        }
        const publicUrl = (env.FRONT_END_URL ?? "").trim().replace(/\/+$/, "");
        if (!host || !from || !publicUrl) {
            throw new Error("Incomplete mail configuration: SMTP_HOST, SMTP_FROM and FRONT_END_URL are all required (or leave SMTP_HOST and SMTP_FROM empty to disable mail).");
        }

        const port = Number(env.SMTP_PORT) || 587;
        const secureSetting = (env.SMTP_SECURE ?? "").trim().toLowerCase();
        const secure = secureSetting ? secureSetting === "true" : port === 465;
        const user = (env.SMTP_USER ?? "").trim() || undefined;
        const requireTlsSetting = (env.SMTP_REQUIRE_TLS ?? "").trim().toLowerCase();
        // With credentials, insist on STARTTLS by default so they can't be sent in clear text.
        const requireTls = !secure && (requireTlsSetting ? requireTlsSetting === "true" : user !== undefined);

        return {host, port, secure, requireTls, user, password: env.SMTP_PASSWORD ?? "", from, publicUrl};
    }

    /**
     * Whether mail is configured.
     * @returns True when SMTP settings are present.
     */
    public isEnabled(): boolean {
        return this.config !== null;
    }

    /**
     * Builds an absolute link into this instance, for use inside an email.
     * @param path Path starting with "/".
     * @returns The absolute URL.
     */
    public link(path: string): string {
        return `${this.config?.publicUrl ?? ""}${path}`;
    }

    /**
     * Sends one plain-text message. Never throws: a delivery failure is
     * logged and reported through the return value.
     * @param to Recipient address.
     * @param subject Subject line.
     * @param text Plain-text body.
     * @returns Whether the SMTP server accepted the message.
     */
    public async send(to: string, subject: string, text: string): Promise<boolean> {
        if (!this.transporter || !this.config) {
            return false;
        }
        const failure = await this.sendReportingError(to, subject, text);
        return failure === null;
    }

    /**
     * Like {@link send}, but reports why delivery failed - for the admin portal's "send test email".
     * @param to Recipient address.
     * @param subject Subject line.
     * @param text Plain-text body.
     * @returns null when the SMTP server accepted the message, otherwise a description of what went wrong.
     */
    public async sendReportingError(to: string, subject: string, text: string): Promise<string | null> {
        if (!this.transporter || !this.config) {
            return "Email is not configured.";
        }
        try {
            await this.transporter.sendMail({
                from: this.config.from,
                // Object form: the address is used as-is, never parsed as a list of recipients.
                to: {name: "", address: to},
                subject,
                text,
            });
            this.recorder?.({to, subject, error: null});
            return null;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Sending mail "${subject}" failed: ${message}`);
            this.recorder?.({to, subject, error: message});
            return message;
        }
    }
}
