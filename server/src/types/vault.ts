import {VaultRoleSource, VaultUserStatus} from "@vaultisse/types/vault/IVaultUser";

export interface Vault {
    id: number;
    name: string;
    description: string;
}

export interface VaultInfo extends Vault {
    invitationUuid: string;
    loansEnabled: boolean;
    /** Whether SSO is enabled on the server, i.e. whether the SSO group mapping can be used. */
    ssoEnabled: boolean;
    /** SSO groups that give access to this vault, each with the role it grants. */
    ssoGroups: VaultSsoGroup[];
    dateCreated: string;
    users: VaultUser[];
    roles: VaultRole[];
}

export interface VaultSsoGroup {
    group_name: string;
    /** `vault_roles.code` granted to members of the group. */
    role: number;
}

export interface VaultUser {
    user_id: number;
    name: string;
    role: string;
    status: VaultUserStatus;
    role_source: VaultRoleSource;
    date_created: string;
}

/** Matches `vault_roles.code` (see assets/db/upgrade/1.3.0.sql) - values don't sort in permission order, use `rank` for that. */
export enum VaultRoleCode {
    NORMAL = 0,
    ADMIN = 1,
    BORROWER = 2,
    READONLY = 3,
    /** Lost their SSO groups while still holding loans: can't take out new books, existing loans stay tracked. */
    RESTRICTED = 4
}

export interface VaultRole {
    code: number;
    name: string;
    rank: number;
    can_borrow: boolean;
    can_edit_catalog: boolean;
    can_manage_members: boolean;
    can_manage_settings: boolean;
}

/** A caller's own standing in a vault - `vault_users` joined to its `vault_roles` permissions. */
export interface VaultMembership {
    role: number;
    status: VaultUserStatus;
    can_borrow: boolean;
    can_edit_catalog: boolean;
    can_manage_members: boolean;
    can_manage_settings: boolean;
}

/**
 * The caller's effective permissions in their active vault, attached to
 * `req.vaultPermissions` by AuthMiddleware and checked per route by
 * `requireVaultPermission` (see middlewares/VaultPermissionMiddleware.ts).
 */
export interface VaultPermissions {
    canBorrow: boolean;
    canEditCatalog: boolean;
    canManageMembers: boolean;
    canManageSettings: boolean;
}

export interface VaultUpdateFields {
    name: string;
    description: string;
    loansEnabled: boolean;
}

/** Preview of a vault reachable via its `invitation_uuid`, shown before the caller decides to request to join. */
export interface VaultInvitePreview {
    id: number;
    name: string;
    description: string;
}
