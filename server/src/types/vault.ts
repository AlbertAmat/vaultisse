export interface Vault {
    id: number;
    name: string;
    description: string;
}

export interface VaultInfo extends Vault {
    invitationUuid: string;
    leasingEnabled: boolean;
    dateCreated: string;
    users: VaultUser[];
    roles: VaultRole[];
}

export interface VaultUser {
    user_id: number;
    name: string;
    role: string;
    status: VaultUserStatus;
    date_created: string;
}

export enum VaultUserStatus {
    PENDING = 0,
    ACCEPTED = 1,
    REJECTED = 2
}

/** Matches `vault_roles.code` (see assets/db/upgrade/1.3.0.sql) - values don't sort in permission order, use `rank` for that. */
export enum VaultRoleCode {
    NORMAL = 0,
    ADMIN = 1,
    BORROWER = 2,
    READONLY = 3
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

export interface VaultUpdateFields {
    name: string;
    description: string;
    leasingEnabled: boolean;
}

/** Preview of a vault reachable via its `invitation_uuid`, shown before the caller decides to request to join. */
export interface VaultInvitePreview {
    id: number;
    name: string;
    description: string;
}
