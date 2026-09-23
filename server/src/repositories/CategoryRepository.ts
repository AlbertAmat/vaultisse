import {Pool, PoolClient} from "pg";
import {Category} from "../types/category";

/** Data access for the `categories` table. See CategoryService for the business rules built on top of this. */
export class CategoryRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Lists every category belonging to `vaultId`.
     * @param vaultId Vault id.
     * @returns Every matching category.
     */
    public async findAll(vaultId: number): Promise<Category[]> {
        const result = await this.db.query(
            `SELECT id, name FROM categories WHERE vault_id = $1`,
            [vaultId]
        );
        return result.rows;
    }

    /**
     * Looks up one category by id, scoped to `vaultId`.
     * @param id Category id.
     * @param vaultId Vault id.
     * @returns The category, or null if it doesn't exist or belongs to someone else.
     */
    public async findById(id: number, vaultId: number): Promise<Category | null> {
        const result = await this.db.query(
            `SELECT categories.id, categories.name
               FROM categories
              WHERE categories.id = $1
                AND categories.vault_id = $2`,
            [id, vaultId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Inserts a new category owned by `vaultId`.
     * @param vaultId Vault id.
     * @param name Category name.
     * @returns The new row's id.
     */
    public async create(vaultId: number, name: string): Promise<number> {
        const result = await this.db.query(
            "INSERT INTO categories (name, vault_id) VALUES ($1, $2) RETURNING id",
            [name, vaultId]
        );
        return result.rows[0].id;
    }

    /**
     * Renames a category, scoped to `vaultId`.
     * @param id Category id.
     * @param vaultId Vault id.
     * @param name New name.
     * @returns Rows affected - 0 if `id` doesn't exist or belongs to another vault.
     */
    public async rename(id: number, vaultId: number, name: string): Promise<number> {
        const result = await this.db.query(
            "UPDATE categories SET name = $1 WHERE id = $2 AND vault_id = $3",
            [name, id, vaultId]
        );
        return result.rowCount ?? 0;
    }

    /**
     * Checks whether a category exists and belongs to `vaultId`.
     * @param id Category id.
     * @param vaultId Vault id.
     * @returns Whether a matching category exists.
     */
    public async exists(id: number, vaultId: number): Promise<boolean> {
        const result = await this.db.query(
            "SELECT id FROM categories WHERE id = $1 AND vault_id = $2",
            [id, vaultId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Deletes a category, scoped to `vaultId`. No-op if it doesn't exist or belongs to someone else.
     * @param id Category id.
     * @param vaultId Vault id.
     */
    public async remove(id: number, vaultId: number): Promise<void> {
        await this.db.query("DELETE FROM categories WHERE id = $1 AND vault_id = $2", [id, vaultId]);
    }
}
