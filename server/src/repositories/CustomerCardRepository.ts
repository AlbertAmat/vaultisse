/**
 * Data access for library cards: the per-vault card settings, each
 * customer's card data, and what the card-scan screen shows (loans and
 * history). See CustomerCardService for the business rules.
 */
import {Pool, PoolClient} from "pg";
import {CardSettingsFields, CustomerCardRow} from "../types/customerCard";
import {VaultRoleCode} from "../types/vault";
import {VaultUserStatus} from "@vaultisse/types/vault/IVaultUser";

/** Data access for library cards. */
export class CustomerCardRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Whether customer photos are off: the caller, or any admin of the
     * vault, is a public-institution account.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @returns Whether photos are blocked.
     */
    public async isPublicInstitution(vaultId: number, userId: number): Promise<boolean> {
        const result = await this.db.query(
            `SELECT EXISTS (
                 SELECT 1
                   FROM users u
                   LEFT JOIN vault_users vu ON vu.user_id = u.id AND vu.vault_id = $1
                  WHERE u.is_public_institution
                    AND (u.id = $2 OR (vu.role = $3 AND vu.status = $4))
             ) AS blocked`,
            [vaultId, userId, VaultRoleCode.ADMIN, VaultUserStatus.ACCEPTED]
        );
        return result.rows[0].blocked;
    }

    /**
     * Reads a vault's card settings.
     * @param vaultId Vault id.
     * @returns The settings and background bytes, or null if never saved.
     */
    public async findSettings(vaultId: number): Promise<(CardSettingsFields & {background: Buffer | null}) | null> {
        const result = await this.db.query(
            `SELECT field1_label, field1_value, field2_label, field2_value, background
               FROM customer_card_settings WHERE vault_id = $1`,
            [vaultId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Saves a vault's card settings.
     * @param vaultId Vault id.
     * @param fields The two custom fields.
     * @param background New background bytes, null to remove it, or undefined to keep it.
     */
    public async saveSettings(vaultId: number, fields: CardSettingsFields, background: Buffer | null | undefined): Promise<void> {
        await this.db.query(
            `INSERT INTO customer_card_settings (vault_id, field1_label, field1_value, field2_label, field2_value, background)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (vault_id) DO UPDATE
                SET field1_label = EXCLUDED.field1_label, field1_value = EXCLUDED.field1_value,
                    field2_label = EXCLUDED.field2_label, field2_value = EXCLUDED.field2_value,
                    background = CASE WHEN $7 THEN EXCLUDED.background ELSE customer_card_settings.background END`,
            [vaultId, fields.field1_label, fields.field1_value, fields.field2_label, fields.field2_value,
                background ?? null, background !== undefined]
        );
    }

    /**
     * Looks up a customer's card by id or by the card's uuid, scoped to the vault.
     * @param vaultId Vault id.
     * @param key `{id}` or `{uuid}` (a valid uuid, with or without hyphens).
     * @returns The card data, or null.
     */
    public async findCard(vaultId: number, key: {id: number} | {uuid: string}): Promise<CustomerCardRow | null> {
        const byId = "id" in key;
        const result = await this.db.query(
            `SELECT c.id, c.uuid, c.name, g.name AS group_name,
                    to_char(c.member_since, 'YYYY-MM-DD') AS member_since, c.image AS photo
               FROM customers c
               LEFT JOIN customer_groups g ON g.id = c.group_id AND g.vault_id = c.vault_id
              WHERE c.vault_id = $1 AND ${byId ? "c.id = $2" : "c.uuid = $2::uuid"}`,
            [vaultId, byId ? key.id : key.uuid]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Updates a customer's photo and/or member-since date.
     * @param vaultId Vault id.
     * @param customerId Customer id.
     * @param memberSince New date, or undefined to keep it.
     * @param photo New photo, null to remove it, or undefined to keep it.
     * @returns Whether the customer exists in this vault.
     */
    public async updateCard(vaultId: number, customerId: number, memberSince: string | undefined, photo: Buffer | null | undefined): Promise<boolean> {
        const result = await this.db.query(
            `UPDATE customers
                SET member_since = COALESCE($3::date, member_since),
                    image = CASE WHEN $5 THEN $4::bytea ELSE image END
              WHERE id = $2 AND vault_id = $1`,
            [vaultId, customerId, memberSince ?? null, photo ?? null, photo !== undefined]
        );
        return (result.rowCount ?? 0) === 1;
    }

    /**
     * Lists the copies a customer has now.
     * @param vaultId Vault id.
     * @param customerId Customer id.
     * @returns Copies on loan, most recent first.
     */
    public async listLoans(vaultId: number, customerId: number): Promise<{code: string; name: string; loaned_at: Date | null}[]> {
        const result = await this.db.query(
            `SELECT bs.code, b.name, bs.loaned_at
               FROM book_stocks bs
               JOIN books b ON b.id = bs.book_id AND b.vault_id = bs.vault_id
              WHERE bs.vault_id = $1 AND bs.customer_id = $2 AND bs.status = 2
              ORDER BY bs.loaned_at DESC NULLS LAST`,
            [vaultId, customerId]
        );
        return result.rows;
    }

    /**
     * Lists a customer's past and open loans.
     * @param vaultId Vault id.
     * @param customerId Customer id.
     * @returns The latest 200, most recent first.
     */
    public async listHistory(vaultId: number, customerId: number): Promise<{stock_code: string; book_name: string; loaned_at: Date; returned_at: Date | null}[]> {
        const result = await this.db.query(
            `SELECT stock_code, book_name, loaned_at, returned_at
               FROM loan_history
              WHERE vault_id = $1 AND customer_id = $2
              ORDER BY loaned_at DESC
              LIMIT 200`,
            [vaultId, customerId]
        );
        return result.rows;
    }

    /**
     * Locks one copy for the rest of the transaction and reads its status.
     * @param vaultId Vault id.
     * @param code Stock code.
     * @returns The status, or null if this vault has no such copy.
     */
    public async lockStockStatus(vaultId: number, code: string): Promise<number | null> {
        const result = await this.db.query(
            `SELECT status FROM book_stocks WHERE vault_id = $1 AND code = $2 FOR UPDATE`,
            [vaultId, code]
        );
        return result.rows[0]?.status ?? null;
    }
}
