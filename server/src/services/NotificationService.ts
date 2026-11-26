/**
 * Email notifications for account security and vault membership events. All
 * methods are fire-and-forget: they do nothing when mail is off and never
 * throw, so a mail problem can't fail the action that triggered it.
 */
import {Pool} from "pg";
import {appService} from "../AppService";
import {NotificationRepository} from "../repositories/NotificationRepository";

/** Composes and sends notification emails. Calls NotificationRepository and MailService. */
export class NotificationService {
    /**
     * @param pool Database connection pool, forwarded to a fresh NotificationRepository on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Runs one notification if mail is enabled, logging instead of propagating any failure.
     * @param task Work that looks up recipients and sends.
     */
    private async deliver(task: (repo: NotificationRepository) => Promise<void>): Promise<void> {
        if (!appService.getMailService().isEnabled()) {
            return;
        }
        try {
            await task(new NotificationRepository(this.pool));
        } catch (error) {
            console.error("Notification failed:", error);
        }
    }

    /**
     * Sends a security notice to a user.
     * @param userId Account that changed.
     * @param subject Subject line.
     * @param event Sentence describing what happened.
     */
    private async securityNotice(userId: number, subject: string, event: string): Promise<void> {
        await this.deliver(async (repo) => {
            const user = await repo.findUser(userId);
            if (user) {
                await appService.getMailService().send(user.email, subject,
                    `Hello ${user.name},\n\n${event}\n\nIf this wasn't you, change your password and contact your administrator.\n`);
            }
        });
    }

    /**
     * Tells a user their password changed.
     * @param userId Account id.
     */
    public async passwordChanged(userId: number): Promise<void> {
        await this.securityNotice(userId, "Your password was changed", "The password of your Vaultisse account was just changed.");
    }

    /**
     * Tells a user two-factor authentication was turned off.
     * @param userId Account id.
     */
    public async twoFactorDisabled(userId: number): Promise<void> {
        await this.securityNotice(userId, "Two-factor authentication was turned off", "Two-factor authentication was just turned off on your Vaultisse account.");
    }

    /**
     * Warns the current address that a change to another one was requested.
     * @param userId Account id.
     */
    public async emailChangeRequested(userId: number): Promise<void> {
        await this.securityNotice(userId, "An email change was requested", "Someone asked to change the email address of your Vaultisse account. It changes once the new address confirms it.");
    }

    /**
     * Tells a vault's member managers that someone asked to join.
     * @param vaultId Vault id.
     * @param requesterId User who asked.
     */
    public async joinRequested(vaultId: number, requesterId: number): Promise<void> {
        await this.deliver(async (repo) => {
            const vaultName = await repo.findVaultName(vaultId);
            const requester = await repo.findUser(requesterId);
            if (!vaultName || !requester) {
                return;
            }
            for (const email of await repo.listMemberManagerEmails(vaultId)) {
                await appService.getMailService().send(email, `New request to join "${vaultName}"`,
                    `${requester.name} (${requester.email}) asked to join the vault "${vaultName}".\n\n` +
                    `Review it under Settings > Vaults:\n${appService.getMailService().link("/app/settings")}\n`);
            }
        });
    }

    /**
     * Tells a user whether their join request was approved or rejected.
     * @param vaultId Vault id.
     * @param userId User who asked.
     * @param approved The decision.
     */
    public async joinDecided(vaultId: number, userId: number, approved: boolean): Promise<void> {
        await this.deliver(async (repo) => {
            const vaultName = await repo.findVaultName(vaultId);
            const user = await repo.findUser(userId);
            if (!vaultName || !user) {
                return;
            }
            const decision = approved ? "approved" : "rejected";
            await appService.getMailService().send(user.email, `Your request to join "${vaultName}" was ${decision}`,
                `Hello ${user.name},\n\nYour request to join the vault "${vaultName}" was ${decision}.\n` +
                (approved ? `\n${appService.getMailService().link("/app")}\n` : ""));
        });
    }
}
