import {Pool} from "pg";
import {VaultRepository} from "../repositories/VaultRepository";
import {UserRepository} from "../repositories/UserRepository";
import {withTransaction} from "../repositories/withTransaction";
import {Vault, VaultInfo, VaultInvitePreview, VaultRole, VaultRoleCode, VaultSsoGroup, VaultUser} from "../types/vault";
import {VaultUserStatus} from "@vaultisse/types/vault/IVaultUser";
import {appService} from "../AppService";
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

        const [users, roles, ssoGroups]: [VaultUser[], VaultRole[], VaultSsoGroup[]] = await Promise.all([
            repo.listMembers(vaultId),
            repo.listRoles(),
            repo.listSsoGroups(vaultId),
        ]);

        return {
            id: details.id,
            name: details.name,
            description: details.description,
            invitationUuid: details.invitation_uuid,
            loansEnabled: details.loans_enabled,
            ssoEnabled: appService.isOidcEnabled(),
            ssoGroups,
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
     * @param loansEnabled Whether the vault uses loans. Turning it off is refused with ConflictError while the
     * vault still has borrower members or books on loan.
     * @returns The updated vault.
     */
    public async updateVault(vaultId: number, userId: number, name: string, description: string | undefined, loansEnabled: boolean): Promise<Vault> {
        if (!name || !name.trim()) {
            throw new ValidationError("Vault name is required");
        }

        const repo = new VaultRepository(this.pool);
        await this.requireMembership(repo, vaultId, userId, (m) => m.can_manage_settings);

        if (!loansEnabled && await repo.isLoansEnabled(vaultId)) {
            if (await repo.countMembersWithRole(vaultId, VaultRoleCode.BORROWER) > 0) {
                throw new ConflictError("Loans can't be disabled while the vault has borrower members - change their role first");
            }
            if (await repo.countCopiesOnLoan(vaultId) > 0) {
                throw new ConflictError("Loans can't be disabled while books are on loan - return them first");
            }
        }

        const rowsAffected = await repo.updateVault(vaultId, {name: name.trim(), description: description?.trim() || "", loansEnabled});
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
     * Deletes a vault, throwing ForbiddenError unless the caller has `can_manage_settings`, and
     * ConflictError if the caller has no other vault to fall back to - deleting your only vault would
     * leave you with no active vault at all (see AuthMiddleware/AppService.getSessionVault).
     *
     * If the vault still owns any content (customers, books, locations, ...), deletion is refused with
     * ConflictError unless `transferToVaultId` names another vault the caller is an accepted member of,
     * in which case every bit of content is moved there first (VaultRepository.mergeVaultInto) and the
     * now-empty vault is removed.
     *
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @param transferToVaultId If the vault has content, the vault to move it into before deleting.
     */
    public async deleteVault(vaultId: number, userId: number, transferToVaultId?: number): Promise<void> {
        const repo = new VaultRepository(this.pool);
        await this.requireMembership(repo, vaultId, userId, (m) => m.can_manage_settings);

        const myVaults = await repo.getVaults(userId);
        if (!myVaults.some((v) => v.id !== vaultId)) {
            throw new ConflictError("This is the only vault you belong to - you can't delete it");
        }

        if (transferToVaultId !== undefined) {
            if (transferToVaultId === vaultId) {
                throw new ValidationError("Choose a different vault to transfer into");
            }
            const targetMembership = await repo.getMembership(transferToVaultId, userId);
            if (!targetMembership || targetMembership.status !== VaultUserStatus.ACCEPTED) {
                throw new NotFoundError("Destination vault not found");
            }

            await withTransaction(this.pool, async (client) => {
                const txRepo = new VaultRepository(client);
                const conflicts = await txRepo.findIsbnConflicts(vaultId, transferToVaultId);
                if (conflicts.length > 0) {
                    throw new ConflictError(`Both vaults have a book with the same ISBN (${conflicts.join(", ")}) - resolve the duplicate before merging`);
                }
                await txRepo.mergeVaultInto(vaultId, transferToVaultId);
            });
            return;
        }

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
     * @param fields New role and/or status - whichever is provided. Setting a role by hand makes the member
     * manual, so the SSO group sync no longer manages (or removes) them.
     */
    public async updateMember(vaultId: number, callerId: number, targetUserId: number, fields: { role?: number; status?: VaultUserStatus }): Promise<void> {
        const repo = new VaultRepository(this.pool);
        await this.requireMembership(repo, vaultId, callerId, (m) => m.can_manage_members);

        if (fields.role === VaultRoleCode.BORROWER && !(await repo.isLoansEnabled(vaultId))) {
            throw new ValidationError("The borrower role needs loans enabled in this vault");
        }

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
     * Replaces the SSO group -> role mapping of a vault, throwing ForbiddenError unless the caller has
     * `can_manage_settings`. An empty list switches the vault back to fully manual membership. Applied to each
     * user at their next SSO login.
     * @param vaultId Vault id.
     * @param callerId Caller's id.
     * @param groups New mapping: group name as the IdP reports it, and the `vault_roles.code` it grants.
     */
    public async setSsoGroups(vaultId: number, callerId: number, groups: VaultSsoGroup[]): Promise<void> {
        const repo = new VaultRepository(this.pool);
        await this.requireMembership(repo, vaultId, callerId, (m) => m.can_manage_settings);

        const roles = await repo.listRoles();
        const loans = await repo.isLoansEnabled(vaultId);
        const seen = new Set<string>();
        const clean: VaultSsoGroup[] = [];
        for (const g of groups) {
            const name = typeof g?.group_name === "string" ? g.group_name.trim() : "";
            if (!name || name.length > 200) {
                throw new ValidationError("Each SSO group needs a name of up to 200 characters");
            }
            if (seen.has(name)) {
                throw new ValidationError(`SSO group "${name}" is listed twice`);
            }
            seen.add(name);
            if (!roles.some((r) => r.code === g.role)) {
                throw new ValidationError(`Invalid role for SSO group "${name}"`);
            }
            if (g.role === VaultRoleCode.BORROWER && !loans) {
                throw new ValidationError("The borrower role needs loans enabled in this vault");
            }
            clean.push({group_name: name, role: g.role});
        }

        await withTransaction(this.pool, async (client) => {
            await new VaultRepository(client).replaceSsoGroups(vaultId, clean);
        });
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
