/**
 * Emails each admin whose password is about to expire, once a day, from ADMIN_PASSWORD_WARN_DAYS (default 5) days before it
 * does and every day after until they change it. The email goes to that admin only (not to everybody), and carries no secret.
 *
 * "Once a day" is kept by `admin_users.password_warned_on`, so a restart or a manual run never sends it twice. Without email
 * set up nothing can be sent: the console shows the same warning at the top of every page instead, and the job says so.
 */
import {Pool} from "pg";
import {appService} from "../../AppService";
import {AdminUserRepository} from "../repositories/AdminUserRepository";
import {AdminAuthService} from "./AdminAuthService";

/** Sends the password-expiry reminders. */
export class PasswordExpiryService {
    private readonly repo: AdminUserRepository;

    /**
     * @param pool Database pool.
     * @param auth Admin auth service (knows the policy).
     */
    public constructor(pool: Pool, private readonly auth: AdminAuthService) {
        this.repo = new AdminUserRepository(pool);
    }

    /**
     * @returns A sentence for the job history.
     * @example "2 reminders sent (1 expires in 3 days, 1 already expired)"  |  "Passwords never expire"  |  "Nobody is near expiry"
     */
    public async run(): Promise<string> {
        let sent = 0;
        let waiting = 0;
        let expiredCount = 0;
        let anyone = false;
        const mail = appService.getMailService();
        const url = appService.getAdminConfig().url;
        for (const admin of await this.repo.listForExpiry()) {
            const expiry = this.auth.passwordExpiry(admin.passwordChangedAt);
            if (expiry.expiresAt === null) {
                return "Passwords never expire";
            }
            if (!expiry.warning || expiry.daysLeft === null || admin.warnedToday) {
                continue;
            }
            anyone = true;
            if (!mail.isEnabled()) {
                waiting++;
                continue;
            }
            const when = expiry.expiresAt.toISOString().slice(0, 10);
            const body = expiry.expired
                ? [`Your Vaultisse admin password expired on ${when}.`, "The next time you sign in you will be asked to choose a new one before you can do anything else."]
                : [`Your Vaultisse admin password expires on ${when} (${expiry.daysLeft} ${expiry.daysLeft === 1 ? "day" : "days"} from now).`, "Choose a new one in the console: account menu > Change password."];
            const subject = expiry.expired ? "Your Vaultisse admin password has expired" : `Your Vaultisse admin password expires in ${expiry.daysLeft} ${expiry.daysLeft === 1 ? "day" : "days"}`;
            const error = await mail.sendReportingError(admin.email, subject, [`Hello ${admin.name},`, "", ...body, "", url ? `Open the admin console: ${url}` : "Open the admin console on its own port.", "", "You get this reminder every day until the password is changed."].join("\n"));
            if (error === null) {
                await this.repo.markPasswordWarned(admin.id);
                sent++;
                if (expiry.expired) expiredCount++;
            }
        }
        if (!anyone) {
            return "Nobody is near expiry";
        }
        const parts = [`${sent} reminder${sent === 1 ? "" : "s"} sent${expiredCount > 0 ? ` (${expiredCount} already expired)` : ""}`];
        if (waiting > 0) parts.push(`${waiting} not sent: email isn't set up (the console warns them instead)`);
        return parts.join("; ");
    }
}
