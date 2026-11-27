/**
 * Deleting accounts and vaults from the admin portal.
 *
 * Deletion is deliberately a two-step thing: requesting it locks the account out (or suspends the vault)
 * straight away and schedules the real deletion after a grace period (setting ADMIN_DELETION_GRACE_DAYS,
 * default 7). Until then it can be cancelled and everything is exactly as it was. A grace period of 0, or
 * an explicit "delete now" from a freshly re-verified admin, carries it out immediately. A background pass
 * (see AdminApp) executes the ones that came due.
 *
 * The actual removal reuses what an account's own "delete my account" does (UserService.removeAccountData,
 * VaultRepository.deleteVaultCompletely), so the two paths can't drift apart.
 */
import {Pool} from "pg";
import {ConflictError, NotFoundError} from "../../errors/DomainError";
import {withTransaction} from "../../repositories/withTransaction";
import {VaultRepository} from "../../repositories/VaultRepository";
import {UserService} from "../../services/UserService";
import {appService} from "../../AppService";
import {Logger} from "../../utils/Logger";
import {DeletionEntity, DeletionRepository, DeletionRow} from "../repositories/DeletionRepository";
import {PlatformRepository} from "../repositories/PlatformRepository";
import {AdminAuditService} from "./AdminAuditService";

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_DELETION = "pending_deletion";

/** Outcome of asking for a deletion. */
export interface DeletionRequestResult {
    deletionId: number;
    /** True when it was carried out right away; false when it waits for its grace period. */
    executed: boolean;
    executeAfter: Date;
}

/** Schedules, cancels and carries out deletions. */
export class DeletionService {
    private readonly deletions: DeletionRepository;
    private readonly platform: PlatformRepository;

    /**
     * @param pool Database pool.
     * @param audit Admin audit trail.
     * @param logger Server logger.
     * @param graceDays Reads the current grace period in days (it is a portal setting that can change).
     */
    public constructor(private readonly pool: Pool, private readonly audit: AdminAuditService, private readonly logger: Logger, private readonly graceDays: () => number) {
        this.deletions = new DeletionRepository(pool);
        this.platform = new PlatformRepository(pool);
    }

    /**
     * Requests deletion of an account: locks it out now, deletes it after the grace period.
     * @param adminId Admin requesting it.
     * @param userId Account id.
     * @param immediate Delete right away instead of waiting.
     * @returns What happened.
     * @throws NotFoundError / ConflictError (already scheduled, or it can't be deleted yet).
     */
    public async requestUserDeletion(adminId: number, userId: number, immediate: boolean): Promise<DeletionRequestResult> {
        const user = await this.platform.findUser(userId);
        if (!user) {
            throw new NotFoundError("Account not found.");
        }
        return this.request("user", userId, `${user.name} (${user.code})`, adminId, immediate, async (client) => {
            await this.platform.setUserDisabled(userId, true, PENDING_DELETION, client);
        });
    }

    /**
     * Requests deletion of a vault: suspends it now, deletes it after the grace period.
     * @param adminId Admin requesting it.
     * @param vaultId Vault id.
     * @param immediate Delete right away instead of waiting.
     * @returns What happened.
     */
    public async requestVaultDeletion(adminId: number, vaultId: number, immediate: boolean): Promise<DeletionRequestResult> {
        const vault = await this.platform.findVault(vaultId);
        if (!vault) {
            throw new NotFoundError("Vault not found.");
        }
        return this.request("vault", vaultId, vault.name, adminId, immediate, async (client) => {
            await this.platform.setVaultSuspended(vaultId, true, PENDING_DELETION, client);
        });
    }

    private async request(type: DeletionEntity, entityId: number, label: string, adminId: number, immediate: boolean, lockOut: (client: import("pg").PoolClient) => Promise<void>): Promise<DeletionRequestResult> {
        const grace = Math.max(0, this.graceDays());
        const now = !!immediate || grace === 0;
        const executeAfter = new Date(Date.now() + (now ? 0 : grace * DAY_MS));
        let deletionId: number;
        try {
            deletionId = await withTransaction(this.pool, async (client) => {
                await lockOut(client);
                return new DeletionRepository(client).schedule(type, entityId, label, adminId, executeAfter);
            });
        } catch (error: any) {
            if (error?.code === "23505") {
                throw new ConflictError("A deletion is already scheduled for this.");
            }
            throw error;
        }
        if (now) {
            await this.execute(deletionId);
        }
        return {deletionId, executed: now, executeAfter};
    }

    /**
     * Cancels a waiting deletion and lifts the lock-out.
     * @param id Deletion id.
     * @returns The cancelled deletion.
     */
    public async cancel(id: number): Promise<DeletionRow> {
        const deletion = await this.requireOpen(id);
        await withTransaction(this.pool, async (client) => {
            if (deletion.entityType === "user") {
                const user = await this.platform.findUser(deletion.entityId);
                if (user?.disabledReason === PENDING_DELETION) {
                    await this.platform.setUserDisabled(deletion.entityId, false, null, client);
                }
            } else {
                const vault = await this.platform.findVault(deletion.entityId);
                if (vault?.suspendedReason === PENDING_DELETION) {
                    await this.platform.setVaultSuspended(deletion.entityId, false, null, client);
                }
            }
            await new DeletionRepository(client).markCancelled(id);
        });
        return deletion;
    }

    /**
     * Carries out a waiting deletion now, whatever its grace period.
     * @param id Deletion id.
     * @returns The deletion that was carried out.
     * @throws ConflictError when it can't be done (e.g. the account is the only admin of a shared vault).
     */
    public async execute(id: number): Promise<DeletionRow> {
        const deletion = await this.requireOpen(id);
        try {
            if (deletion.entityType === "user") {
                if (await this.platform.findUser(deletion.entityId)) {
                    await withTransaction(this.pool, (client) => UserService.removeAccountData(client, deletion.entityId));
                }
            } else if (await this.platform.findVault(deletion.entityId)) {
                await withTransaction(this.pool, (client) => new VaultRepository(client).deleteVaultCompletely(deletion.entityId));
            }
        } catch (error: any) {
            const message = error?.code === "P0001"
                ? "This account is the only admin of a vault it shares with others. Delete that vault, or make someone else its admin, first."
                : (error instanceof Error ? error.message : String(error));
            await this.deletions.markFailed(id, message);
            throw new ConflictError(message);
        }
        await this.deletions.markExecuted(id);
        return deletion;
    }

    /**
     * Carries out every deletion whose grace period is over. One failing doesn't stop the others.
     * @returns How many were deleted.
     */
    public async executeDue(): Promise<number> {
        let done = 0;
        for (const deletion of await this.deletions.due()) {
            try {
                await this.execute(deletion.id);
                done++;
                this.logger.warn(`Deleted ${deletion.entityType} id=${deletion.entityId} (scheduled from the admin portal)`);
                void appService.getNotifier().notify("deletions", {
                    title: `A scheduled ${deletion.entityType === "user" ? "account" : "vault"} deletion was carried out`,
                    lines: [`${deletion.entityLabel} was deleted after its grace period.`, `Requested by: ${deletion.requestedBy ?? "unknown"}.`],
                });
                await this.audit.recordAs("deletion.executed", {id: null, email: null}, null, {
                    entityType: deletion.entityType, entityId: deletion.entityId, entityLabel: deletion.entityLabel,
                    metadata: {deletionId: deletion.id, requestedBy: deletion.requestedBy},
                });
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                this.logger.error(`Scheduled deletion ${deletion.id} failed: ${reason}`);
                void appService.getNotifier().notify("deletions", {
                    title: "A scheduled deletion failed",
                    lines: [`${deletion.entityLabel} (${deletion.entityType}) could not be deleted: ${reason}`, "It stays locked. See Deletions in the console."],
                    dedupeKey: `failed-${deletion.id}`,
                    cooldownMs: 24 * 60 * 60 * 1000,
                });
            }
        }
        return done;
    }

    /**
     * @param openOnly Only deletions still waiting.
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of deletions.
     */
    public list(openOnly: boolean, limit: number, offset: number) {
        return this.deletions.list(openOnly, limit, offset);
    }

    private async requireOpen(id: number): Promise<DeletionRow> {
        const deletion = await this.deletions.find(id);
        if (!deletion) {
            throw new NotFoundError("Deletion not found.");
        }
        if (deletion.cancelledAt || deletion.executedAt) {
            throw new ConflictError("This deletion is no longer pending.");
        }
        return deletion;
    }
}
