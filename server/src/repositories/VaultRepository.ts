import {Pool, PoolClient} from "pg";
import {Vault, VaultInvitePreview, VaultMembership, VaultRole, VaultRoleCode, VaultUpdateFields, VaultUser, VaultUserStatus} from "../types/vault";

/** Data access for the `vault`, `vault_users`, and `vault_roles` tables. See VaultService for the business rules built on top of this. */
export class VaultRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Get vault basic information, scoped to an accepted membership.
     * @param vaultId Vault id.
     * @param userId Caller's id - must be an accepted member.
     */
    public async getVault(vaultId: number, userId: number): Promise<Vault | null> {
        const result = await this.db.query(
            `SELECT vault.id, vault.name, vault.description
               FROM vault
               JOIN vault_users vu ON vu.vault_id = vault.id
              WHERE vault.id = $1
                AND vu.user_id = $2
                AND vu.status = $3`,
            [vaultId, userId, VaultUserStatus.ACCEPTED]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Get list of the caller's accepted vaults.
     * @param userId Caller's id.
     */
    public async getVaults(userId: number): Promise<Vault[]> {
        const result = await this.db.query(
            `SELECT vault.id, vault.name, vault.description
               FROM vault
               JOIN vault_users vu ON vu.vault_id = vault.id
              WHERE vu.user_id = $1
                AND vu.status = $2`,
            [userId, VaultUserStatus.ACCEPTED]
        );
        return result.rows ?? [];
    }

    /**
     * Get the extended fields (beyond id/name/description) needed to assemble a VaultInfo, scoped to an accepted membership.
     * @param vaultId Vault id.
     * @param userId Caller's id - must be an accepted member.
     */
    public async getVaultDetails(vaultId: number, userId: number): Promise<{
        id: number;
        name: string;
        description: string;
        invitation_uuid: string;
        leasing_enabled: boolean;
        date_created: string;
    } | null> {
        const result = await this.db.query(
            `SELECT vault.id, vault.name, vault.description, vault.invitation_uuid, vault.leasing_enabled, vault.date_created
               FROM vault
               JOIN vault_users vu ON vu.vault_id = vault.id
              WHERE vault.id = $1
                AND vu.user_id = $2
                AND vu.status = $3`,
            [vaultId, userId, VaultUserStatus.ACCEPTED]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Inserts a new vault.
     * @param name Vault name.
     * @param description Vault description.
     * @returns The new row's id.
     */
    public async createVault(name: string, description: string | null): Promise<number> {
        const result = await this.db.query(
            "INSERT INTO vault (name, description) VALUES ($1, $2) RETURNING id",
            [name, description]
        );
        return result.rows[0].id;
    }

    /**
     * Adds a member to a vault.
     * @param vaultId Vault id.
     * @param userId Member's id.
     * @param role Role code (references vault_roles.code).
     * @param status Membership status.
     */
    public async addMember(vaultId: number, userId: number, role: number, status: VaultUserStatus): Promise<void> {
        await this.db.query(
            "INSERT INTO vault_users (vault_id, user_id, role, status) VALUES ($1, $2, $3, $4)",
            [vaultId, userId, role, status]
        );
    }

    /**
     * Updates a vault's editable settings.
     * @param vaultId Vault id.
     * @param fields New field values.
     * @returns Rows affected - 0 if the vault doesn't exist.
     */
    public async updateVault(vaultId: number, fields: VaultUpdateFields): Promise<number> {
        const result = await this.db.query(
            "UPDATE vault SET name = $1, description = $2, leasing_enabled = $3 WHERE id = $4",
            [fields.name, fields.description, fields.leasingEnabled, vaultId]
        );
        return result.rowCount ?? 0;
    }

    /**
     * Deletes a vault. Blocked at the DB level (FK RESTRICT, surfaced as
     * Postgres error code 23503 - see VaultService.deleteVault) while it
     * still owns any content.
     *
     * `trg_vault_min_one_admin` (assets/db/upgrade/1.3.0.sql) exists to stop
     * a vault being left admin-less while it still has other members, not
     * to allow deleting the vault outright - it would otherwise block the
     * `ON DELETE CASCADE` this triggers on the vault's own `vault_users`
     * rows too (removing the last one always looks like "removing the last
     * admin"). Disabled for just the delete itself, always re-enabled
     * afterward regardless of outcome - this repository is never called
     * inside a shared transaction (see the one caller, VaultService.deleteVault),
     * so a failed delete here doesn't abort anything the re-enable would
     * then run against.
     *
     * Reassigns `users.last_used_vault_id` (to another vault that user
     * belongs to, or NULL) for every member this vault is currently active
     * for, before touching anything else - that column has no `ON DELETE`
     * clause, so leaving it dangling would otherwise fail this very DELETE
     * with the same 23503 that VaultService.deleteVault reads as "still has
     * content", even for a vault that's genuinely empty.
     *
     * @param vaultId Vault id.
     */
    public async removeVault(vaultId: number): Promise<void> {
        await this.db.query(
            `UPDATE users u
                SET last_used_vault_id = (
                    SELECT vu.vault_id FROM vault_users vu
                    WHERE vu.user_id = u.id AND vu.vault_id != $1
                    ORDER BY vu.vault_id LIMIT 1
                )
              WHERE u.last_used_vault_id = $1`,
            [vaultId]
        );

        await this.db.query("ALTER TABLE vault_users DISABLE TRIGGER trg_vault_min_one_admin");
        try {
            await this.db.query("DELETE FROM vault WHERE id = $1", [vaultId]);
        } finally {
            await this.db.query("ALTER TABLE vault_users ENABLE TRIGGER trg_vault_min_one_admin");
        }
    }

    /**
     * Finds isbns present in both vaults. mergeVaultInto moves books as-is,
     * which would violate books_isbn_vault_unique if the target vault
     * already has a different book with the same isbn - the caller
     * (VaultService.deleteVault) checks this first, in the same
     * transaction, and asks the user to resolve it manually rather than
     * silently dropping or guessing which copy should win.
     *
     * @param sourceVaultId Vault being merged away.
     * @param targetVaultId Vault receiving its content.
     * @returns The names of the conflicting books.
     */
    public async findIsbnConflicts(sourceVaultId: number, targetVaultId: number): Promise<string[]> {
        const result = await this.db.query(
            `SELECT s.name
               FROM books s
               JOIN books t ON t.vault_id = $2 AND t.isbn = s.isbn
              WHERE s.vault_id = $1
                AND s.isbn IS NOT NULL`,
            [sourceVaultId, targetVaultId]
        );
        return result.rows.map((row: {name: string}) => row.name);
    }

    /**
     * Merges a vault's entire content into another vault the caller already
     * belongs to, then removes the (now empty) source vault - the
     * alternative to the plain "refuse while it still has content" path in
     * removeVault, used when VaultService.deleteVault is given a
     * transferToVaultId.
     *
     * Categories/authors/customer_groups are unique per vault by name
     * (unique_vault_category/unique_vault_author/unique_vault_customer_group),
     * so a same-named row already in the target is reused (references
     * repointed, the source row dropped) instead of moved - a plain
     * `UPDATE ... SET vault_id` would violate those constraints whenever
     * both vaults happen to use the same name, which is common (e.g.
     * "Fiction"). Locations and customers aren't name-unique, so they're
     * just moved, except a source vault's default location is demoted
     * first if the target already has one of its own
     * (locations_one_default_per_vault allows only one per vault). Books
     * are moved as-is - callers must have already ruled out isbn collisions
     * with the target vault (see findIsbnConflicts), since two genuinely
     * different physical copies sharing an isbn across vaults is an
     * ambiguous case this method refuses to guess at.
     *
     * Must run inside a transaction (see VaultService.deleteVault) - a
     * partial merge left by a crash partway through would be effectively
     * unrecoverable. No try/finally around the trigger disable at the end,
     * for the same reason as deleteVaultCompletely: DDL is transactional,
     * so a failure anywhere above rolls back the DISABLE along with
     * everything else, and a finally here would instead run against an
     * already-aborted transaction and mask the real error.
     *
     * @param sourceVaultId Vault being emptied and removed.
     * @param targetVaultId Vault receiving its content.
     */
    public async mergeVaultInto(sourceVaultId: number, targetVaultId: number): Promise<void> {
        const categories = await this.db.query(
            `SELECT s.id AS source_id, t.id AS target_id
               FROM categories s
               LEFT JOIN categories t ON t.vault_id = $2 AND t.name = s.name
              WHERE s.vault_id = $1`,
            [sourceVaultId, targetVaultId]
        );
        for (const row of categories.rows) {
            if (row.target_id) {
                await this.db.query("UPDATE books SET category_id = $1 WHERE category_id = $2", [row.target_id, row.source_id]);
                await this.db.query("DELETE FROM categories WHERE id = $1", [row.source_id]);
            } else {
                await this.db.query("UPDATE categories SET vault_id = $1 WHERE id = $2", [targetVaultId, row.source_id]);
            }
        }

        // book_authors' PK is (book_id, author_id), so repointing a book
        // that already links both the source and target author would
        // collide on a plain UPDATE - insert the repointed row with
        // ON CONFLICT DO NOTHING first, then drop the old ones.
        const authors = await this.db.query(
            `SELECT s.id AS source_id, t.id AS target_id
               FROM authors s
               LEFT JOIN authors t ON t.vault_id = $2 AND t.name = s.name
              WHERE s.vault_id = $1`,
            [sourceVaultId, targetVaultId]
        );
        for (const row of authors.rows) {
            if (row.target_id) {
                await this.db.query(
                    `INSERT INTO book_authors (book_id, author_id, vault_id)
                     SELECT book_id, $1, $2 FROM book_authors WHERE author_id = $3
                     ON CONFLICT DO NOTHING`,
                    [row.target_id, targetVaultId, row.source_id]
                );
                await this.db.query("DELETE FROM book_authors WHERE author_id = $1", [row.source_id]);
                await this.db.query("DELETE FROM authors WHERE id = $1", [row.source_id]);
            } else {
                await this.db.query("UPDATE authors SET vault_id = $1 WHERE id = $2", [targetVaultId, row.source_id]);
            }
        }

        const groups = await this.db.query(
            `SELECT s.id AS source_id, t.id AS target_id
               FROM customer_groups s
               LEFT JOIN customer_groups t ON t.vault_id = $2 AND t.name = s.name
              WHERE s.vault_id = $1`,
            [sourceVaultId, targetVaultId]
        );
        for (const row of groups.rows) {
            if (row.target_id) {
                await this.db.query("UPDATE customers SET group_id = $1 WHERE group_id = $2", [row.target_id, row.source_id]);
                await this.db.query("DELETE FROM customer_groups WHERE id = $1", [row.source_id]);
            } else {
                await this.db.query("UPDATE customer_groups SET vault_id = $1 WHERE id = $2", [targetVaultId, row.source_id]);
            }
        }

        // Demote the source vault's default location before moving it, if
        // the target already has one of its own - the two can't coexist.
        await this.db.query(
            `UPDATE locations SET "default" = FALSE
              WHERE vault_id = $1
                AND "default" = TRUE
                AND EXISTS (SELECT 1 FROM locations WHERE vault_id = $2 AND "default" = TRUE)`,
            [sourceVaultId, targetVaultId]
        );
        await this.db.query("UPDATE locations SET vault_id = $1 WHERE vault_id = $2", [targetVaultId, sourceVaultId]);

        // Customers aren't name-unique per vault - moved as-is. group_id
        // already points at the correct (merged-or-moved) target-vault row.
        await this.db.query("UPDATE customers SET vault_id = $1 WHERE vault_id = $2", [targetVaultId, sourceVaultId]);

        // category_id already points at the correct (merged-or-moved)
        // target-vault row; isbn conflicts were already ruled out by the caller.
        await this.db.query("UPDATE books SET vault_id = $1 WHERE vault_id = $2", [targetVaultId, sourceVaultId]);

        // Everything else hanging off books/authors just follows vault_id -
        // no name-uniqueness of its own to reconcile.
        await this.db.query("UPDATE book_stocks SET vault_id = $1 WHERE vault_id = $2", [targetVaultId, sourceVaultId]);
        await this.db.query("UPDATE book_authors SET vault_id = $1 WHERE vault_id = $2", [targetVaultId, sourceVaultId]);
        await this.db.query("UPDATE book_files SET vault_id = $1 WHERE vault_id = $2", [targetVaultId, sourceVaultId]);
        await this.db.query("UPDATE loan_history SET vault_id = $1 WHERE vault_id = $2", [targetVaultId, sourceVaultId]);

        // Anyone who had the source vault active now has its content in the
        // target vault instead - reassign rather than leave them dangling.
        await this.db.query("UPDATE users SET last_used_vault_id = $1 WHERE last_used_vault_id = $2", [targetVaultId, sourceVaultId]);

        await this.db.query("ALTER TABLE vault_users DISABLE TRIGGER trg_vault_min_one_admin");
        await this.db.query("DELETE FROM vault_users WHERE vault_id = $1", [sourceVaultId]);
        await this.db.query("DELETE FROM vault WHERE id = $1", [sourceVaultId]);
        await this.db.query("ALTER TABLE vault_users ENABLE TRIGGER trg_vault_min_one_admin");
    }

    /**
     * Looks up the caller's own role/status and effective permissions within a vault.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @returns The caller's membership, or null if they're not a member at all.
     */
    public async getMembership(vaultId: number, userId: number): Promise<VaultMembership | null> {
        const result = await this.db.query(
            `SELECT vu.role,
                    vu.status,
                    vr.can_borrow,
                    vr.can_edit_catalog,
                    vr.can_manage_members,
                    vr.can_manage_settings
               FROM vault_users vu
               JOIN vault_roles vr ON vr.code = vu.role
              WHERE vu.vault_id = $1
                AND vu.user_id = $2`,
            [vaultId, userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Lists every role definition, ordered least to most permissive.
     */
    public async listRoles(): Promise<VaultRole[]> {
        const result = await this.db.query(
            `SELECT code, name, rank, can_borrow, can_edit_catalog, can_manage_members, can_manage_settings
               FROM vault_roles
              ORDER BY rank`
        );
        return result.rows ?? [];
    }

    /**
     * Lists every member of a vault (any status), most recently joined last.
     * @param vaultId Vault id.
     */
    public async listMembers(vaultId: number): Promise<VaultUser[]> {
        const result = await this.db.query(
            `SELECT vu.user_id, u.name, vr.name AS role, vu.status, vu.date_created
               FROM vault_users vu
               JOIN users u ON u.id = vu.user_id
               JOIN vault_roles vr ON vr.code = vu.role
              WHERE vu.vault_id = $1
              ORDER BY vu.date_created`,
            [vaultId]
        );
        return result.rows ?? [];
    }

    /**
     * Looks up a vault by its shareable invitation link, for the "you've been invited" preview shown before joining.
     * @param invitationUuid The vault's invitation_uuid.
     */
    public async findByInvitationUuid(invitationUuid: string): Promise<VaultInvitePreview | null> {
        const result = await this.db.query(
            "SELECT id, name, description FROM vault WHERE invitation_uuid = $1",
            [invitationUuid]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Records a pending join request. No-ops (rather than erroring) if the user is already a member in any status.
     * @param vaultId Vault id.
     * @param userId Requesting user's id.
     * @returns Whether a new row was actually inserted.
     */
    public async requestJoin(vaultId: number, userId: number): Promise<boolean> {
        const result = await this.db.query(
            `INSERT INTO vault_users (vault_id, user_id, role, status)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (vault_id, user_id) DO NOTHING
             RETURNING vault_id`,
            [vaultId, userId, VaultRoleCode.READONLY, VaultUserStatus.PENDING]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Updates a member's role and/or status. Passing only one of `role`/`status` leaves the other untouched.
     * The DB trigger `trg_vault_min_one_admin` rejects a change that would leave the vault without an admin.
     * @param vaultId Vault id.
     * @param userId Member's id.
     * @param fields Fields to change.
     * @returns Rows affected - 0 if that user isn't a member of that vault.
     */
    public async updateMember(vaultId: number, userId: number, fields: { role?: number; status?: VaultUserStatus }): Promise<number> {
        const result = await this.db.query(
            `UPDATE vault_users
                SET role = COALESCE($1, role),
                    status = COALESCE($2, status)
              WHERE vault_id = $3
                AND user_id = $4`,
            [fields.role ?? null, fields.status ?? null, vaultId, userId]
        );
        return result.rowCount ?? 0;
    }

    /**
     * Removes a member from a vault (also used for a member leaving on their own).
     * The DB trigger `trg_vault_min_one_admin` rejects removing a vault's last admin.
     *
     * Also reassigns `users.last_used_vault_id` (falling back to another
     * vault this user still belongs to, or NULL if none) when it pointed at
     * `vaultId` - AuthMiddleware resolves every request's `req.vaultId`
     * fresh from that column, so leaving it dangling here wouldn't just
     * block deleting the vault later (it has no `ON DELETE` clause), it
     * would leave this user's *next request* still resolving into a vault
     * they were just removed from. One statement, not a separate
     * check-then-update: the two CTEs run against the same pre-statement
     * snapshot, so `fallback` explicitly excludes `vaultId` rather than
     * relying on `removed` having already run.
     *
     * @param vaultId Vault id.
     * @param userId Member's id.
     */
    public async removeMember(vaultId: number, userId: number): Promise<void> {
        await this.db.query(
            `WITH removed AS (
                 DELETE FROM vault_users WHERE vault_id = $1 AND user_id = $2 RETURNING user_id
             ), fallback AS (
                 SELECT vault_id FROM vault_users WHERE user_id = $2 AND vault_id != $1 ORDER BY vault_id LIMIT 1
             )
             UPDATE users
                SET last_used_vault_id = (SELECT vault_id FROM fallback)
              WHERE id = $2
                AND last_used_vault_id = $1
                AND EXISTS (SELECT 1 FROM removed)`,
            [vaultId, userId]
        );
    }

    /**
     * Lists every vault `userId` belongs to where they're the *only* member -
     * used by UserService.deleteAccount to find which of a deleted account's
     * vaults have no one else left depending on them (a shared vault the
     * caller isn't the sole member of is left untouched, even if they're its
     * only admin - see deleteVaultCompletely's own note on why that case
     * isn't handled here).
     * @param userId Member's id.
     * @returns Every vault id where `userId` is the sole `vault_users` row.
     */
    public async findSoleMemberVaultIds(userId: number): Promise<number[]> {
        const result = await this.db.query(
            `SELECT vu.vault_id
               FROM vault_users vu
              WHERE vu.user_id = $1
                AND (SELECT COUNT(*) FROM vault_users vu2 WHERE vu2.vault_id = vu.vault_id) = 1`,
            [userId]
        );
        return result.rows.map((row: {vault_id: number}) => row.vault_id);
    }

    /**
     * Fully tears down a vault: every table hanging off `vault_id` (books -
     * which cascades book_stocks/book_authors/book_files - then customers,
     * customer_groups, locations, categories, authors, and loan_history),
     * then the vault row itself.
     *
     * `trg_vault_min_one_admin` (assets/db/upgrade/1.3.0.sql) exists to stop
     * a vault being left admin-less while other members/content remain, not
     * to allow tearing the whole thing down - it would otherwise block
     * deleting this vault's own `vault_users` row (or the cascade from
     * deleting `vault` itself) once no admins remain. Disabled for just that
     * one statement, always re-enabled even on failure, and never left
     * disabled across a `COMMIT` since a caller runs this inside its own
     * transaction (see UserService.deleteAccount).
     *
     * Callers must have already confirmed nothing else depends on this vault
     * (see findSoleMemberVaultIds) - this has no ownership/membership check
     * of its own.
     *
     * @param vaultId Vault id to tear down completely.
     */
    public async deleteVaultCompletely(vaultId: number): Promise<void> {
        await this.db.query("DELETE FROM books WHERE vault_id = $1", [vaultId]);
        await this.db.query("DELETE FROM customers WHERE vault_id = $1", [vaultId]);
        await this.db.query("DELETE FROM customer_groups WHERE vault_id = $1", [vaultId]);
        await this.db.query("DELETE FROM locations WHERE vault_id = $1", [vaultId]);
        await this.db.query("DELETE FROM categories WHERE vault_id = $1", [vaultId]);
        await this.db.query("DELETE FROM authors WHERE vault_id = $1", [vaultId]);
        await this.db.query("DELETE FROM loan_history WHERE vault_id = $1", [vaultId]);

        // No try/finally re-enabling this on failure: ALTER TABLE ... TRIGGER
        // is transactional DDL, so if any statement below throws, the whole
        // transaction this runs in (see UserService.deleteAccount) rolls
        // back and undoes the DISABLE along with everything else - a
        // finally block here would instead run against an already-aborted
        // transaction and mask the real error with "current transaction is
        // aborted, commands ignored until end of transaction block".
        await this.db.query("ALTER TABLE vault_users DISABLE TRIGGER trg_vault_min_one_admin");
        await this.db.query("DELETE FROM vault_users WHERE vault_id = $1", [vaultId]);
        // users.last_used_vault_id references this vault too (set on login/
        // register - see AppService/AuthService) - clear it for anyone still
        // pointing at it (normally just the caller, about to be deleted
        // right after this by UserService.deleteAccount) so the FK doesn't
        // block the vault delete below.
        await this.db.query("UPDATE users SET last_used_vault_id = NULL WHERE last_used_vault_id = $1", [vaultId]);
        await this.db.query("DELETE FROM vault WHERE id = $1", [vaultId]);
        await this.db.query("ALTER TABLE vault_users ENABLE TRIGGER trg_vault_min_one_admin");
    }
}
