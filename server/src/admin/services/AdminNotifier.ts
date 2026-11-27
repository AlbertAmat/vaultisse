/**
 * Emails the admins about what needs their attention: accounts waiting for approval, unusual security
 * activity, database problems, emails that fail to send, deletions, new versions, restarts.
 *
 * Two sources of events: some are raised the moment they happen (a registration, a deletion), others are
 * found by a check that runs every five minutes (database health, security counters, mail failures, new
 * version). Every event type can be switched off in the portal. The same alert is not repeated within its
 * cooldown, so a problem that lasts doesn't fill inboxes. Everything attempted is recorded in
 * `admin_notifications`, including what was skipped because email isn't set up or nobody subscribed.
 *
 * Recipients are the enabled admins whose "receive notifications" switch is on. Does nothing while the
 * portal is off.
 */
import {Pool} from "pg";
import {appService} from "../../AppService";
import {Logger} from "../../utils/Logger";
import {AdminNotificationRepository} from "../repositories/AdminNotificationRepository";
import {AdminUserRepository} from "../repositories/AdminUserRepository";
import {SecurityRepository} from "../repositories/SecurityRepository";
import {findSetting} from "./settingsCatalog";

export type NotificationType = "user_pending" | "security" | "database" | "mail_failures" | "deletions" | "updates" | "startup" | "test";

/** Setting that switches each event type on or off. */
export const NOTIFICATION_SWITCH: Record<Exclude<NotificationType, "test">, string> = {
    user_pending: "ADMIN_NOTIFY_USER_PENDING",
    security: "ADMIN_NOTIFY_SECURITY",
    database: "ADMIN_NOTIFY_DATABASE",
    mail_failures: "ADMIN_NOTIFY_MAIL_FAILURES",
    deletions: "ADMIN_NOTIFY_DELETIONS",
    updates: "ADMIN_NOTIFY_UPDATES",
    startup: "ADMIN_NOTIFY_STARTUP",
};

export interface NotificationRequest {
    title: string;
    /** Lines of the email body. */
    lines: string[];
    /** Identity of the alert, for the cooldown. */
    dedupeKey?: string;
    /** Don't raise the same alert again within this time. */
    cooldownMs?: number;
}

const HOUR = 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MAIL_FAILURE_THRESHOLD = 5;
const ADMIN_LOGIN_FAILURE_THRESHOLD = 3;

/** Sends the admin notifications. */
export class AdminNotifier {
    private readonly history: AdminNotificationRepository;
    private readonly admins: AdminUserRepository;
    private readonly security: SecurityRepository;
    private recipientCache: string[] = [];
    private readonly memoryCooldown = new Map<string, number>();
    private timers: NodeJS.Timeout[] = [];

    /**
     * @param pool Database pool.
     * @param logger Server logger.
     * @param enabled Whether the admin portal is on.
     */
    public constructor(private readonly pool: Pool, private readonly logger: Logger, private readonly enabled: boolean) {
        this.history = new AdminNotificationRepository(pool);
        this.admins = new AdminUserRepository(pool);
        this.security = new SecurityRepository(pool);
    }

    /**
     * @param key Setting key.
     * @returns Its boolean value (portal setting, env var, or catalog default).
     */
    private flag(key: string): boolean {
        const raw = appService.getSettings().get(key);
        return (raw === undefined || raw === "" ? findSetting(key)?.defaultValue : raw) === "true";
    }

    private number(key: string): number | null {
        const raw = appService.getSettings().get(key);
        const value = Number(raw === undefined || raw === "" ? findSetting(key)?.defaultValue : raw);
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    /** @returns Whether notifications of this type are switched on. */
    public isOn(type: Exclude<NotificationType, "test">): boolean {
        return this.flag(NOTIFICATION_SWITCH[type]);
    }

    /**
     * @returns Addresses of the subscribed admins; the last known list when the database can't be read.
     */
    public async recipients(): Promise<string[]> {
        try {
            this.recipientCache = await this.admins.notificationRecipients();
        } catch {
            // Keep the last list: a database outage is exactly when the admins need to hear about it.
        }
        return this.recipientCache;
    }

    /**
     * Raises one notification (when its type is on and it isn't within its cooldown).
     * @param type Event type.
     * @param request What to say.
     * @returns Whether an email attempt was made.
     */
    public async notify(type: Exclude<NotificationType, "test">, request: NotificationRequest): Promise<boolean> {
        if (!this.enabled || !this.isOn(type)) {
            return false;
        }
        const subject = `[Vaultisse] ${request.title}`;
        const key = request.dedupeKey ? `${type}:${request.dedupeKey}` : null;
        try {
            if (key && request.cooldownMs && await this.inCooldown(key, request.cooldownMs)) {
                return false;
            }
            const recipients = await this.recipients();
            const mail = appService.getMailService();
            if (!mail.isEnabled()) {
                await this.record(type, subject, 0, "skipped", "Email isn't configured.", key);
                return false;
            }
            if (recipients.length === 0) {
                await this.record(type, subject, 0, "skipped", "No admin has notifications switched on.", key);
                return false;
            }
            const body = this.body(request);
            let delivered = 0;
            let lastError = "";
            for (const to of recipients) {
                const error = await mail.sendReportingError(to, subject, body);
                if (error === null) {
                    delivered++;
                } else {
                    lastError = error;
                }
            }
            await this.record(type, subject, delivered, delivered > 0 ? "sent" : "failed", delivered === recipients.length ? null : lastError, key);
            return true;
        } catch (error) {
            this.logger.error(`Admin notification "${subject}" failed: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    private body(request: NotificationRequest): string {
        const config = appService.getAdminConfig();
        return [
            ...request.lines,
            "",
            config.url ? `Open the admin console: ${config.url}` : "Open the admin console on its own port.",
            "",
            `Instance ${appService.getInstanceUuid()}`,
            "You receive this because you are an admin with notifications switched on. Change that under Notifications in the console.",
        ].join("\n");
    }

    private async inCooldown(key: string, cooldownMs: number): Promise<boolean> {
        const last = this.memoryCooldown.get(key);
        if (last && Date.now() - last < cooldownMs) {
            return true;
        }
        try {
            if (await this.history.raisedRecently(key, cooldownMs)) {
                return true;
            }
        } catch {
            // Database down: the in-memory cooldown above is all there is.
        }
        return false;
    }

    private async record(type: string, subject: string, recipients: number, status: "sent" | "failed" | "skipped", detail: string | null, dedupeKey: string | null): Promise<void> {
        // Only an alert that was really attempted starts its cooldown. One that was skipped (email not set
        // up yet, nobody subscribed) must not swallow the first real alert after that is fixed.
        const counts = status !== "skipped";
        if (dedupeKey && counts) {
            this.memoryCooldown.set(dedupeKey, Date.now());
        }
        try {
            await this.history.add({type, subject, recipients, status, detail, dedupeKey: counts ? dedupeKey : null});
        } catch (error) {
            this.logger.error(`Recording an admin notification failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Starts the periodic checks and the one-off start-up notice.
     * @param bootTime When this server started (to list the migrations it applied).
     */
    public start(bootTime: Date): void {
        if (!this.enabled || this.timers.length > 0) {
            return;
        }
        const startup = setTimeout(() => void this.announceStartup(bootTime), 20 * 1000);
        const first = setTimeout(() => void this.runChecks(), 60 * 1000);
        const every = setInterval(() => void this.runChecks(), CHECK_INTERVAL_MS);
        [startup, first, every].forEach((timer) => timer.unref());
        this.timers.push(startup, first, every);
    }

    /** Stops the periodic checks. */
    public stop(): void {
        this.timers.forEach((timer) => clearTimeout(timer));
        this.timers = [];
    }

    private async announceStartup(bootTime: Date): Promise<void> {
        let migrations: string[] = [];
        try {
            migrations = await appService.getSystemInfo().migrationsSince(bootTime);
        } catch {
            // Reported without the list.
        }
        await this.notify("startup", {
            title: "The server started",
            lines: [
                `Vaultisse ${process.env.APP_VERSION || "dev"} started at ${bootTime.toISOString()}.`,
                migrations.length ? `Database migrations applied during this start: ${migrations.join(", ")}.` : "No database migrations were needed.",
            ],
        });
    }

    /** One pass of the checks. Each is independent; one failing doesn't stop the others. */
    public async runChecks(): Promise<void> {
        for (const check of [() => this.checkDatabase(), () => this.checkSecurity(), () => this.checkMail(), () => this.checkUpdates()]) {
            try {
                await check();
            } catch (error) {
                this.logger.error(`Admin health check failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    private async checkDatabase(): Promise<void> {
        if (!this.isOn("database")) {
            return;
        }
        const info = await appService.getSystemInfo().database();
        if (info.status === "ok") {
            return;
        }
        const down = info.status === "down";
        await this.notify("database", {
            title: down ? "The database can't be reached" : "Database warning",
            lines: info.problems,
            dedupeKey: down ? "down" : `warning:${info.problems.map((p) => p.replace(/\d+/g, "#")).join("|")}`,
            cooldownMs: down ? HOUR : 6 * HOUR,
        });
    }

    private async checkSecurity(): Promise<void> {
        if (!this.isOn("security")) {
            return;
        }
        await appService.getSecurityEvents().flush();
        const since = new Date(Date.now() - 10 * 60 * 1000);
        const counts = await this.security.countByType(since);
        const total = (...types: string[]) => counts.filter((c) => types.includes(c.type)).reduce((sum, c) => sum + c.total, 0);
        const threshold = this.number("ADMIN_NOTIFY_SECURITY_THRESHOLD") ?? 50;
        const spike = total("login_failed", "login_locked", "rate_limited");
        if (spike >= threshold) {
            const top = (await this.security.topIps(since, 3)).map((ip) => `  ${ip.ipAddress}: ${ip.total} events`);
            await this.notify("security", {
                title: "Unusual security activity",
                lines: [`${spike} failed logins, lockouts and rate-limited requests in the last 10 minutes (alert threshold: ${threshold}).`, "Busiest addresses:", ...top, "", "See Security in the console; you can block an address there."],
                dedupeKey: "spike",
                cooldownMs: HOUR,
            });
        }
        const adminFailures = total("admin_login_failed");
        if (adminFailures >= ADMIN_LOGIN_FAILURE_THRESHOLD) {
            await this.notify("security", {
                title: "Failed logins to the admin console",
                lines: [`${adminFailures} failed attempts to sign in to the admin console in the last 10 minutes.`, "If that wasn't you, check Security and the Audit trail."],
                dedupeKey: "admin-logins",
                cooldownMs: HOUR,
            });
        }
    }

    private async checkMail(): Promise<void> {
        if (!this.isOn("mail_failures")) {
            return;
        }
        const result = await this.pool.query(
            "SELECT COUNT(*)::int AS failed, MAX(error) AS error FROM mail_log WHERE status = 'failed' AND created_date > $1",
            [new Date(Date.now() - HOUR)]
        );
        const {failed, error} = result.rows[0];
        if (failed >= MAIL_FAILURE_THRESHOLD) {
            await this.notify("mail_failures", {
                title: "Emails are failing to send",
                lines: [`${failed} emails were refused by the mail server in the last hour.`, `Last error: ${error ?? "unknown"}`, "Check the email settings (Settings > Email) and Logs > Emails sent."],
                dedupeKey: "failures",
                cooldownMs: 6 * HOUR,
            });
        }
    }

    private async checkUpdates(): Promise<void> {
        if (!this.isOn("updates")) {
            return;
        }
        const status = await appService.getUpdateChecker().status();
        if (status.updateAvailable && status.latest) {
            await this.notify("updates", {
                title: `Vaultisse ${status.latest} is available`,
                lines: [`This server runs ${status.installed}. The latest release is ${status.latest}.`, status.releaseUrl ? `Release notes: ${status.releaseUrl}` : ""],
                dedupeKey: status.latest,
                cooldownMs: 30 * 24 * HOUR,
            });
        }
    }

    /** @returns Size alert limit in MB, or null. Exposed for the System page. */
    public databaseSizeLimitMb(): number | null {
        return this.number("ADMIN_NOTIFY_DB_SIZE_MB");
    }

    /**
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of the history.
     */
    public listHistory(limit: number, offset: number) {
        return this.history.list(limit, offset);
    }

    /** Removes history entries older than 90 days. */
    public async purgeOld(): Promise<void> {
        await this.history.purge(new Date(Date.now() - 90 * 24 * HOUR));
    }
}
