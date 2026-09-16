import {Pool} from "pg";
import {VaultRepository} from "../repositories/VaultRepository";
import {UserRepository} from "../repositories/UserRepository";
import {withTransaction} from "../repositories/withTransaction";
import {Vault, VaultInfo, VaultInvitePreview, VaultRole, VaultRoleCode, VaultUser, VaultUserStatus} from "../types/vault";
import {ConflictError, ForbiddenError, NotFoundError, ValidationError} from "../errors/DomainError";

/** Business rules for the Vault resource (vault CRUD, membership, invitations). Calls VaultRepository/UserRepository; throws DomainError subclasses for expected failures. */
export class VaultService {
    /**
     * @param pool Database connection pool, forwarded to fresh repositories on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Lists the caller's accepted vaults.
     * @param userId Caller's id.
     * @returns Every vault the caller is an accepted member of.
     */
    public async listVaults(userId: number): Promise<Vault[]> {
        return new VaultRepository(this.pool).getVaults(userId);
    }

    /**
     * Gets a single vault's full detail (settings + members + role definitions), throwing NotFoundError
     * if the caller isn't an accepted member.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @returns The vault's full detail.
     */
    public async getVault(vaultId: number, userId: number): Promise<VaultInfo> {
        const repo = new VaultRepository(this.pool);
        const details = await repo.getVaultDetails(vaultId, userId);
        if (!details) {
            throw new NotFoundError("Vault not found");
        }

        const [users, roles]: [VaultUser[], VaultRole[]] = await Promise.all([
            repo.listMembers(vaultId),
            repo.listRoles(),
        ]);

        return {
            id: details.id,
            name: details.name,
            description: details.description,
            invitationUuid: details.invitation_uuid,
            leasingEnabled: details.leasing_enabled,
            dateCreated: details.date_created,
            users,
            roles,
        };
    }

    /**
     * Creates a vault and enrolls the caller as its first (accepted) admin, atomically.
     * @param userId Caller's id - becomes the vault's admin.
     * @param name Vault name.
     * @param description Optional vault description.
     * @returns The newly-created vault.
     */
    public async createVault(userId: number, name: string, description: string | undefined): Promise<Vault> {
        if (!name || !name.trim()) {
            throw new ValidationError("Vault name is required");
        }

        return withTransaction(this.pool, async (client) => {
            const repo = new VaultRepository(client);
            const id = await repo.createVault(name.trim(), description?.trim() || null);
            await repo.addMember(id, userId, VaultRoleCode.ADMIN, VaultUserStatus.ACCEPTED);
            const vault = await repo.getVault(id, userId);
            if (!vault) {
                throw new NotFoundError("Vault not found after creation");
            }
            return vault;
        });
    }

    /**
     * Updates a vault's settings, throwing ForbiddenError unless the caller has `can_manage_settings`.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @param name New name.
     * @param description New description.
     * @param leasingEnabled New leasing preference.
     * @returns The updated vault.
     */
    public async updateVault(vaultId: number, userId: number, name: string, description: string | undefined, leasingEnabled: boolean): Promise<Vault> {
        if (!name || !name.trim()) {
            throw new ValidationError("Vault name is required");
        }

        const repo = new VaultRepository(this.pool);
        await this.requireMembership(repo, vaultId, userId, (m) => m.can_manage_settings);

        const rowsAffected = await repo.updateVault(vaultId, {name: name.trim(), description: description?.trim() || "", leasingEnabled});
        if (rowsAffected !== 1) {
            throw new NotFoundError("Vault not found");
        }
        const vault = await repo.getVault(vaultId, userId);
        if (!vault) {
            throw new NotFoundError("Vault not found after update");
        }
        return vault;
    }

    /**
     * Deletes a vault, throwing ForbiddenError unless the caller has `can_manage_settings` and
     * ConflictError if the vault still owns any content (customers, books, locations, ...) - deleting a
     * vault out from under its content isn't supported yet, see assets/db/upgrade/1.3.0.sql's top note.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     */
    public async deleteVault(vaultId: number, userId: number): Promise<void> {
        const repo = new VaultRepository(this.pool);
        await this.requireMembership(repo, vaultId, userId, (m) => m.can_manage_settings);

        try {
            await repo.removeVault(vaultId);
        } catch (error: any) {
            if (error.code === '23503') {
                throw new ConflictError("Vault still has content and can't be deleted");
            }
            throw error;
        }
    }

    /**
     * Lists every role definition, for populating a role picker.
     */
    public async listRoles(): Promise<VaultRole[]> {
        return new VaultRepository(this.pool).listRoles();
    }

    /**
     * Previews a vault reachable by its invitation link, before the caller decides to request to join.
     * @param invitationUuid The vault's invitation_uuid.
     * @returns The vault's public name/description.
     */
    public async previewInvite(invitationUuid: string): Promise<VaultInvitePreview> {
        const vault = await new VaultRepository(this.pool).findByInvitationUuid(invitationUuid);
        if (!vault) {
            throw new NotFoundError("Invitation not found");
        }
        return vault;
    }

    /**
     * Requests to join a vault via its invitation link. Starts at the least-privileged role, pending
     * approval from a member with `can_manage_members`. Throws ConflictError if the caller is already a
     * member (pending, accepted, or rejected).
     * @param invitationUuid The vault's invitation_uuid.
     * @param userId Requesting user's id.
     * @returns The vault the caller requested to join.
     */
    public async joinVault(invitationUuid: string, userId: number): Promise<VaultInvitePreview> {
        const repo = new VaultRepository(this.pool);
        const vault = await repo.findByInvitationUuid(invitationUuid);
        if (!vault) {
            throw new NotFoundError("Invitation not found");
        }

        const inserted = await repo.requestJoin(vault.id, userId);
        if (!inserted) {
            throw new ConflictError("Already a member of this vault");
        }
        return vault;
    }

    /**
     * Lists every member of a vault, throwing NotFoundError unless the caller is an accepted member.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     */
    public async listMembers(vaultId: number, userId: number): Promise<VaultUser[]> {
        const repo = new VaultRepository(this.pool);
        const membership = await repo.getMembership(vaultId, userId);
        if (!membership || membership.status !== VaultUserStatus.ACCEPTED) {
            throw new NotFoundError("Vault not found");
        }
        return repo.listMembers(vaultId);
    }

    /**
     * Updates a member's role and/or approval status, throwing ForbiddenError unless the caller has
     * `can_manage_members`. Approving/rejecting a pending join request is just setting `status` here.
     * A change that would leave the vault without an admin is rejected by the DB trigger and surfaces as
     * ValidationError.
     * @param vaultId Vault id.
     * @param callerId Caller's id.
     * @param targetUserId Member being changed.
     * @param fields New role and/or status - whichever is provided.
     */
    public async updateMember(vaultId: number, callerId: number, targetUserId: number, fields: { role?: number; status?: VaultUserStatus }): Promise<void> {
        const repo = new VaultRepository(this.pool);
        await this.requireMembership(repo, vaultId, callerId, (m) => m.can_manage_members);

        try {
            const rowsAffected = await repo.updateMember(vaultId, targetUserId, fields);
            if (rowsAffected !== 1) {
                throw new NotFoundError("Member not found");
            }
        } catch (error: any) {
            if (error.code === 'P0001') {
                throw new ValidationError(error.message);
            }
            throw error;
        }
    }

    /**
     * Removes a member from a vault - either the caller leaving on their own, or someone with
     * `can_manage_members` removing another member. A removal that would leave the vault without an
     * admin is rejected by the DB trigger and surfaces as ValidationError.
     * @param vaultId Vault id.
     * @param callerId Caller's id.
     * @param targetUserId Member being removed.
     */
    public async removeMember(vaultId: number, callerId: number, targetUserId: number): Promise<void> {
        const repo = new VaultRepository(this.pool);
        if (callerId !== targetUserId) {
            await this.requireMembership(repo, vaultId, callerId, (m) => m.can_manage_members);
        } else {
            const membership = await repo.getMembership(vaultId, callerId);
            if (!membership) {
                throw new NotFoundError("Vault not found");
            }
        }

        try {
            await repo.removeMember(vaultId, targetUserId);
        } catch (error: any) {
            if (error.code === 'P0001') {
                throw new ValidationError(error.message);
            }
            throw error;
        }
    }

    /**
     * Sets which vault the caller last worked in, throwing NotFoundError unless they're an accepted member.
     * @param userId Caller's id.
     * @param vaultId Vault to make active.
     */
    public async setActiveVault(userId: number, vaultId: number): Promise<void> {
        const vaultRepo = new VaultRepository(this.pool);
        const membership = await vaultRepo.getMembership(vaultId, userId);
        if (!membership || membership.status !== VaultUserStatus.ACCEPTED) {
            throw new NotFoundError("Vault not found");
        }
        await new UserRepository(this.pool).setActiveVault(userId, vaultId);
    }

    /**
     * Shared guard for admin-only vault actions: loads the caller's membership and throws NotFoundError
     * if they're not an accepted member at all, or ForbiddenError if `predicate` rejects their permissions.
     * @param repo Repository to query membership through.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @param predicate Permission check against the caller's membership.
     */
    private async requireMembership(repo: VaultRepository, vaultId: number, userId: number, predicate: (membership: {
        can_borrow: boolean;
        can_edit_catalog: boolean;
        can_manage_members: boolean;
        can_manage_settings: boolean;
        status: VaultUserStatus;
    }) => boolean): Promise<void> {
        const membership = await repo.getMembership(vaultId, userId);
        if (!membership || membership.status !== VaultUserStatus.ACCEPTED) {
            throw new NotFoundError("Vault not found");
        }
        if (!predicate(membership)) {
            throw new ForbiddenError("You don't have permission to do that in this vault");
        }
    }
}
