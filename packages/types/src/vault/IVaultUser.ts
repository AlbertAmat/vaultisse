/** Matches `vault_users.status`. Also used by the server (see packages/README.md). */
export enum VaultUserStatus {
    PENDING = 0,
    ACCEPTED = 1,
    REJECTED = 2,
}

/** Matches `vault_users.role_source`: who manages the membership. Also used by the server. */
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
    /** How the member got in: added by hand, or by the vault's SSO group mapping (then removed when they leave the groups). */
    role_source: VaultRoleSource;
    /** ISO date the member row was created (join/invite request date). */
    date_created: string;
}
