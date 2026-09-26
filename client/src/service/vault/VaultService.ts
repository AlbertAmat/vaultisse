import {PATH_PREFIX} from "@/Constants";
import axiosInstance from "@/plugins/axiosInstance";
import IVault from "@/types/vault/IVault";
import IVaultInfo from "@/types/vault/IVaultInfo";
import IVaultInvitePreview from "@/types/vault/IVaultInvitePreview";
import {IVaultRole} from "@/types/vault/IVaultRole";
import {VaultUserStatus} from "@/types/vault/IVaultUser";

/**
 * Thin HTTP client for the `/api/rest/vault` endpoints (see
 * server/src/routes/VaultRoute.ts): vault CRUD, membership management, and
 * switching the caller's active vault.
 */
class VaultService {

    /**
     * Lists the caller's accepted vaults.
     */
    public async list(): Promise<IVault[]> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/vault`);
        return data;
    }

    /**
     * Lists the fixed role definitions (readonly/borrower/normal/admin), for a role picker.
     */
    public async listRoles(): Promise<IVaultRole[]> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/vault/roles`);
        return data;
    }

    /**
     * Gets one vault's full detail: settings, every member, and the role definitions.
     * @param id Vault id.
     */
    public async get(id: number): Promise<IVaultInfo> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/vault/${id}`);
        return data;
    }

    /**
     * Creates a new vault, with the caller enrolled as its first (admin) member.
     * @param name Vault name.
     * @param description Optional vault description.
     */
    public async create(name: string, description: string | undefined): Promise<IVault> {
        const {data} = await axiosInstance.post(`${PATH_PREFIX}/vault`, {name, description});
        return data;
    }

    /**
     * Updates a vault's name/description/leasing preference. Requires `can_manage_settings`.
     * @param id Vault id.
     * @param name New name.
     * @param description New description.
     * @param leasingEnabled New leasing preference.
     */
    public async update(id: number, name: string, description: string | undefined, leasingEnabled: boolean): Promise<IVault> {
        const {data} = await axiosInstance.put(`${PATH_PREFIX}/vault/${id}`, {name, description, leasingEnabled});
        return data;
    }

    /**
     * Deletes a vault. Requires `can_manage_settings`. Rejected (409) if the caller has no other vault,
     * and (unless `transferToVaultId` names another vault the caller belongs to, to move it into first)
     * while it still owns any content. The error dialog is suppressed so VaultMembersDialog.vue can
     * decide for itself whether a 409 means "show the transfer picker" or a real failure to surface.
     * @param id Vault id.
     * @param transferToVaultId Destination vault for the content, if the vault has any.
     */
    public async remove(id: number, transferToVaultId?: number): Promise<void> {
        await axiosInstance.delete(`${PATH_PREFIX}/vault/${id}`, {
            data: transferToVaultId !== undefined ? {transferToVaultId} : undefined,
            suppressErrorDialog: true,
        } as any);
    }

    /**
     * Sets the vault the caller last worked in (loaded on next login).
     * @param id Vault id to make active.
     */
    public async setActive(id: number): Promise<void> {
        await axiosInstance.put(`${PATH_PREFIX}/vault/${id}/active`);
    }

    /**
     * Updates a member's role and/or approval status. Approving/rejecting a
     * pending join request is just setting `status` here. Requires `can_manage_members`.
     * @param vaultId Vault id.
     * @param userId Member's id.
     * @param fields Fields to change - either, or both.
     */
    public async updateMember(vaultId: number, userId: number, fields: {role?: number; status?: VaultUserStatus}): Promise<void> {
        await axiosInstance.put(`${PATH_PREFIX}/vault/${vaultId}/members/${userId}`, fields);
    }

    /**
     * Removes a member from a vault (or leaves it, when `userId` is the caller's own id).
     * @param vaultId Vault id.
     * @param userId Member's id.
     */
    public async removeMember(vaultId: number, userId: number): Promise<void> {
        await axiosInstance.delete(`${PATH_PREFIX}/vault/${vaultId}/members/${userId}`);
    }

    /**
     * Previews a vault reachable by its invitation link, before deciding to request to join (see VaultJoinView.vue).
     * @param uuid The vault's invitation uuid.
     */
    public async previewInvite(uuid: string): Promise<IVaultInvitePreview> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/vault/invite/${uuid}`);
        return data;
    }

    /**
     * Requests to join a vault via its invitation link, at the least-privileged role, pending approval.
     * @param uuid The vault's invitation uuid.
     */
    public async join(uuid: string): Promise<IVaultInvitePreview> {
        const {data} = await axiosInstance.post(`${PATH_PREFIX}/vault/join/${uuid}`);
        return data;
    }
}

export const vaultService = new VaultService();
