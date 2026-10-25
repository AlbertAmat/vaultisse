import IVault from "./IVault";
import {IVaultUser} from "./IVaultUser";
import {IVaultRole} from "./IVaultRole";

/** One SSO group -> role mapping of a vault. */
export interface IVaultSsoGroup {
    /** Group name as the identity provider reports it. */
    group_name: string;
    /** `vault_roles.code` granted to members of the group. */
    role: number;
}

/**
 * One vault's full detail: settings, every member, and the role
 * definitions - as returned by `GET /vault/:id` (see
 * server/src/routes/VaultRoute.ts).
 */
export default interface IVaultInfo extends IVault {
    /** Shareable UUID for the "join this vault" invite link. */
    invitationUuid: string;
    /** Whether the Loans/Customers pages are offered to this vault's members. */
    loansEnabled: boolean;
    /** Whether SSO is enabled on the server, so the SSO group mapping can be used. */
    ssoEnabled: boolean;
    /** SSO groups that give access to this vault, each with the role it grants. */
    ssoGroups: IVaultSsoGroup[];
    /** ISO date the vault was created. */
    dateCreated: string;
    /** Every member, any status. */
    users: IVaultUser[];
    /** Every fixed role definition, least to most permissive. */
    roles: IVaultRole[];
}
