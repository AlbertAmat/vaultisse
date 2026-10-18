/** Matches `vault_users.status` / `VaultUserStatus` server-side. */
export enum VaultUserStatus {
    PENDING = 0,
    ACCEPTED = 1,
    REJECTED = 2,
}

/** Matches `vault_users.role_source` / `VaultRoleSource` server-side. */
export enum VaultRoleSource {
    MANUAL = 0,
    OIDC = 1,
}

/**
 * One member row of a vault (any status - pending/accepted/rejected), as
 * returned by `GET /vault/:id` and `GET /vault/:id/members` (see
 * server/src/routes/VaultRoute.ts).
 */
export interface IVaultUser {
    /** Member's account id. */
    user_id: number;
    /** Member's display name. */
    name: string;
    /** Role name (e.g. "admin") - not the numeric code, see IVaultRole for the picker's own shape. */
    role: string;
    status: VaultUserStatus;
    /** Who decides the role: set by hand, or following the member's SSO groups. */
    role_source: VaultRoleSource;
    /** Whether the member has an SSO identity, so their role can follow SSO groups. */
    oidc_linked: boolean;
    /** ISO date the member row was created (join/invite request date). */
    date_created: string;
}
