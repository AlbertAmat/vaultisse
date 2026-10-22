import IVault from "./IVault";
import {IVaultUser} from "./IVaultUser";
import {IVaultRole} from "./IVaultRole";

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
    /** Whether the server maps SSO groups to roles, so members can be set to follow them. */
    oidcGroupSync: boolean;
    /** ISO date the vault was created. */
    dateCreated: string;
    /** Every member, any status. */
    users: IVaultUser[];
    /** Every fixed role definition, least to most permissive. */
    roles: IVaultRole[];
}
