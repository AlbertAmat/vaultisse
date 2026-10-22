/**
 * A vault (shared library) the caller belongs to, as returned by
 * `GET /vault` and `POST/PUT /vault` (see server/src/routes/VaultRoute.ts).
 */
export default interface IVault {
    /** Vault id. */
    id: number;
    /** Vault name (e.g. "Jane's library"). */
    name: string;
    /** Optional description. */
    description: string | null;
}
