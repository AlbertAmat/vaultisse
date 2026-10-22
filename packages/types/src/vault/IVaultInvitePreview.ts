/**
 * Preview of a vault reachable via its invitation link, shown before the
 * caller decides to request to join it (see `GET /vault/invite/:uuid` and
 * VaultJoinView.vue).
 */
export default interface IVaultInvitePreview {
    id: number;
    name: string;
    description: string | null;
}
