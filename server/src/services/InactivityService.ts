/**
 * Optional deletion of inactive accounts. Off unless
 * ACCOUNT_INACTIVITY_DAYS is set. With ACCOUNT_DELETION_NOTICE_DAYS, an
 * account is emailed that many days ahead and is never deleted until that
 * much time has passed since a warning was actually sent.
 */
import {Pool} from "pg";
import {appService} from "../AppService";
import {InactivityRepository, InactiveAccount} from "../repositories/InactivityRepository";
import {withTransaction} from "../repositories/withTransaction";
import {UserService} from "./UserService";

/** Resolved settings - see InactivityService.readConfig. */
export interface InactivityConfig {
    inactivityDays: number;
    /** 0 deletes without warning. */
    noticeDays: number;
}

/** Warns and deletes inactive accounts. Calls InactivityRepository, MailService and UserService. */
export class InactivityService {
    /**
     * @param pool Database connection pool.
     * @param config Cleanup settings.
     */
    public constructor(private readonly pool: Pool, private readonly config: InactivityConfig) {
    }

    /**
     * Parses one day-count variable.
     * @param env Environment variables.
     * @param name Variable name.
     * @returns The number, or 0 when unset.
     * @throws Error unless it's a whole number of days - this deletes data, so don't guess.
     */
    private static readDays(env: NodeJS.ProcessEnv, name: string): number {
        const raw = (env[name] ?? "").trim();
        if (!raw) {
            return 0;
        }
        if (!/^\d{1,5}$/.test(raw)) {
            throw new Error(`${name} must be a whole number of days, got "${raw}".`);
        }
        return Number(raw);
    }

    /**
     * Reads the settings from the environment.
     * @param env Environment variables.
     * @param mailEnabled Whether warnings can be emailed.
     * @returns The settings, or null when the cleanup is off.
     * @throws Error on invalid values, a notice period not shorter than the inactivity period, or a notice period without mail.
     */
    public static readConfig(env: NodeJS.ProcessEnv, mailEnabled: boolean): InactivityConfig | null {
        const inactivityDays = InactivityService.readDays(env, "ACCOUNT_INACTIVITY_DAYS");
        if (inactivityDays === 0) {
            return null;
        }
        const noticeDays = InactivityService.readDays(env, "ACCOUNT_DELETION_NOTICE_DAYS");
        if (noticeDays >= inactivityDays) {
            throw new Error("ACCOUNT_DELETION_NOTICE_DAYS must be smaller than ACCOUNT_INACTIVITY_DAYS.");
        }
        if (noticeDays > 0 && !mailEnabled) {
            throw new Error("ACCOUNT_DELETION_NOTICE_DAYS needs mail: configure SMTP_HOST and SMTP_FROM, or leave it empty to delete without warning.");
        }
        return {inactivityDays, noticeDays};
    }

    /**
     * Emails the deletion warning, recording it only if the server accepted it.
     * @param account Account to warn.
     * @returns Whether it was sent.
     */
    private async warn(account: InactiveAccount): Promise<boolean> {
        const mail = appService.getMailService();
        const days = this.config.noticeDays;
        const sent = await mail.send(account.email, "Your account will be deleted for inactivity",
            `Hello ${account.name},\n\nYou haven't used your Vaultisse account in a while. ` +
            `It will be deleted in ${days} day${days === 1 ? "" : "s"}, along with any library only you belong to.\n\n` +
            `To keep it, just log in:\n${mail.link("/login")}\n`);
        if (sent) {
            await new InactivityRepository(this.pool).markWarned(account.id);
        }
        return sent;
    }

    /**
     * Deletes one account, unless it became active or ineligible meanwhile.
     * @param userId Account id.
     * @returns Whether it was deleted.
     */
    private async remove(userId: number): Promise<boolean> {
        return withTransaction(this.pool, async (client) => {
            const [still] = await new InactivityRepository(client).listInactive(this.config.inactivityDays, userId);
            if (!still) {
                return false;
            }
            await UserService.removeAccountData(client, userId);
            return true;
        });
    }

    /**
     * Runs one pass: warns accounts entering the notice period and deletes
     * those past it. One account failing doesn't stop the others.
     * @returns How many accounts were warned and deleted.
     */
    public async run(): Promise<{warned: number; deleted: number}> {
        const {inactivityDays, noticeDays} = this.config;
        const repo = new InactivityRepository(this.pool);
        let warned = 0;
        let deleted = 0;

        for (const account of await repo.listInactive(inactivityDays - noticeDays)) {
            try {
                if (noticeDays > 0) {
                    if (account.warnedAt === null) {
                        warned += (await this.warn(account)) ? 1 : 0;
                        continue;
                    }
                    if (!(await repo.noticeElapsed(account.warnedAt, noticeDays))) {
                        continue;
                    }
                }
                if (await this.remove(account.id)) {
                    deleted++;
                    appService.getLogger().warn(`Deleted inactive account id=${account.id}`);
                }
            } catch (error) {
                console.error(`Inactive-account cleanup failed for user ${account.id}:`, error);
            }
        }

        return {warned, deleted};
    }
}
