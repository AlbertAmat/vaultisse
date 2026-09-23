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
     * Deletes a vault. Blocked at the DB level (FK RESTRICT) while it still owns any content.
     * @param vaultId Vault id.
     */
    public async removeVault(vaultId: number): Promise<void> {
        await this.db.query("DELETE FROM vault WHERE id = $1", [vaultId]);
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
     * @param vaultId Vault id.
     * @param userId Member's id.
     */
    public async removeMember(vaultId: number, userId: number): Promise<void> {
        await this.db.query("DELETE FROM vault_users WHERE vault_id = $1 AND user_id = $2", [vaultId, userId]);
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
