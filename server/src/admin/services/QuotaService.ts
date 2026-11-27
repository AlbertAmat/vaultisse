/**
 * Plan quotas for vaults. A vault's limits come from its plan, or from the default plan when it has none;
 * a NULL limit (or no plan at all) means unlimited.
 *
 * Quotas only exist while the admin portal is enabled (that is where plans are managed): with the portal
 * off every check passes, so a plain self-hosted install is never limited.
 *
 * The checks are called from the user-facing services before they add something (a book, a member, a
 * file). They only block *adding*: a vault already above a freshly lowered limit keeps what it has.
 */
import {Pool, PoolClient} from "pg";
import {appService} from "../../AppService";
import {ForbiddenError} from "../../errors/DomainError";
import {PlanRepository, PlanRow} from "../repositories/PlanRepository";

/** What a vault currently uses. */
export interface VaultUsage {
    books: number;
    members: number;
    storageBytes: number;
}

/** Quota checks and usage figures. */
export class QuotaService {
    /** Static-only utility class, never instantiated. */
    private constructor() {
    }

    /**
     * @param db Pool or transaction client.
     * @param vaultId Vault id.
     * @returns The plan in force for the vault, or null for unlimited (or while the portal is off).
     */
    public static async planFor(db: Pool | PoolClient, vaultId: number): Promise<PlanRow | null> {
        if (!appService.isAdminEnabled()) {
            return null;
        }
        return new PlanRepository(db as Pool).effectiveForVault(vaultId);
    }

    /**
     * @param db Pool or transaction client.
     * @param vaultId Vault id.
     * @returns What the vault currently uses.
     */
    public static async usage(db: Pool | PoolClient, vaultId: number): Promise<VaultUsage> {
        const result = await db.query(
            `SELECT (SELECT COUNT(*)::int FROM books WHERE vault_id = $1) AS books,
                    (SELECT COUNT(*)::int FROM vault_users WHERE vault_id = $1 AND status IN (0, 1)) AS members,
                    (COALESCE((SELECT SUM(file_size) FROM book_files WHERE vault_id = $1), 0)
                     + COALESCE((SELECT SUM(octet_length(image_url)) FROM books WHERE vault_id = $1 AND image_url LIKE 'data:%'), 0)
                     + COALESCE((SELECT SUM(octet_length(image)) FROM customers WHERE vault_id = $1), 0))::bigint AS "storageBytes"`,
            [vaultId]
        );
        const row = result.rows[0];
        return {books: row.books, members: row.members, storageBytes: Number(row.storageBytes)};
    }

    /**
     * @param db Pool or transaction client.
     * @param vaultId Vault id.
     * @param adding How many books are about to be added.
     * @throws ForbiddenError when that would pass the plan's book limit.
     */
    public static async assertCanAddBooks(db: Pool | PoolClient, vaultId: number, adding: number = 1): Promise<void> {
        const plan = await QuotaService.planFor(db, vaultId);
        if (!plan || plan.maxBooks === null) {
            return;
        }
        const {books} = await QuotaService.usage(db, vaultId);
        if (books + adding > plan.maxBooks) {
            throw new ForbiddenError(`This library's plan (${plan.name}) allows at most ${plan.maxBooks} books.`);
        }
    }

    /**
     * @param db Pool or transaction client.
     * @param vaultId Vault id.
     * @throws ForbiddenError when another member (or pending request) would pass the plan's member limit.
     */
    public static async assertCanAddMember(db: Pool | PoolClient, vaultId: number): Promise<void> {
        const plan = await QuotaService.planFor(db, vaultId);
        if (!plan || plan.maxMembers === null) {
            return;
        }
        const {members} = await QuotaService.usage(db, vaultId);
        if (members + 1 > plan.maxMembers) {
            throw new ForbiddenError(`This library's plan (${plan.name}) allows at most ${plan.maxMembers} members.`);
        }
    }

    /**
     * @param db Pool or transaction client.
     * @param vaultId Vault id.
     * @param addingBytes Size of what is about to be stored.
     * @throws ForbiddenError when that would pass the plan's storage limit.
     */
    public static async assertCanAddStorage(db: Pool | PoolClient, vaultId: number, addingBytes: number): Promise<void> {
        const plan = await QuotaService.planFor(db, vaultId);
        if (!plan || plan.maxStorageMb === null) {
            return;
        }
        const {storageBytes} = await QuotaService.usage(db, vaultId);
        if (storageBytes + addingBytes > plan.maxStorageMb * 1024 * 1024) {
            throw new ForbiddenError(`This library's plan (${plan.name}) allows at most ${plan.maxStorageMb} MB of storage.`);
        }
    }
}
