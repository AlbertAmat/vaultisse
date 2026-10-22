/**
 * A fixed vault role definition (readonly/borrower/normal/admin) and its
 * permissions, as returned by `GET /vault/roles` (see
 * server/src/routes/VaultRoute.ts). `rank` (not `code`) is what "most
 * permissive" comparisons should sort on - `code` values don't sort in
 * permission order.
 */
export interface IVaultRole {
    /** Matches `vault_roles.code` / `VaultRoleCode` server-side. */
    code: number;
    /** Role name (e.g. "admin"). */
    name: string;
    /** Sort key from least to most permissive - use this, not `code`, to compare roles. */
    rank: number;
    can_borrow: boolean;
    can_edit_catalog: boolean;
    can_manage_members: boolean;
    can_manage_settings: boolean;
}
