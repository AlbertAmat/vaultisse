import {Pool, PoolClient} from "pg";
import {Author} from "../types/author";

/** Data access for the `authors` table. See AuthorService for the business rules built on top of this. */
export class AuthorRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Lists every author belonging to `vaultId`.
     * @param vaultId Vault id.
     * @returns Every matching author.
     */
    public async findAll(vaultId: number): Promise<Author[]> {
        const result = await this.db.query(
            `SELECT id, name FROM authors WHERE vault_id = $1`,
            [vaultId]
        );
        return result.rows;
    }

    /**
     * Case-insensitive substring search by name, for the author autocomplete/picker.
     * @param vaultId Vault id.
     * @param query Substring to search for, case-insensitive.
     * @returns Every matching author.
     */
    public async search(vaultId: number, query: string): Promise<Author[]> {
        const result = await this.db.query(
            `SELECT authors.id, authors.name
               FROM authors
              WHERE LOWER(authors.name) ILIKE $1
                AND authors.vault_id = $2`,
            [`%${query.toLocaleLowerCase()}%`, vaultId]
        );
        return result.rows;
    }

    /**
     * Looks up one author by id, scoped to `vaultId`.
     * @param id Author id.
     * @param vaultId Vault id.
     * @returns The author, or null if it doesn't exist or belongs to someone else.
     */
    public async findById(id: number | string, vaultId: number): Promise<Author | null> {
        const result = await this.db.query(
            `SELECT authors.id, authors.name
               FROM authors
              WHERE authors.id = $1
                AND authors.vault_id = $2`,
            [id, vaultId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Inserts a new author owned by `vaultId`.
     * @param vaultId Vault id.
     * @param name Author name.
     * @returns The new row's id.
     */
    public async create(vaultId: number, name: string): Promise<number> {
        const result = await this.db.query(
            "INSERT INTO authors (name, vault_id) VALUES ($1, $2) RETURNING id",
            [name, vaultId]
        );
        return result.rows[0].id;
    }

    /**
     * Renames an author, scoped to `vaultId`.
     * @param id Author id.
     * @param vaultId Vault id.
     * @param name New name.
     * @returns Rows affected - 0 if `id` doesn't exist or belongs to another vault.
     */
    public async rename(id: string, vaultId: number, name: string): Promise<number> {
        const result = await this.db.query(
            "UPDATE authors SET name = $1 WHERE id = $2 AND vault_id = $3",
            [name, id, vaultId]
        );
        return result.rowCount ?? 0;
    }

    /**
     * Checks whether an author exists and belongs to `vaultId`. Also used by BookService to validate an incoming `authorId`.
     * @param id Author id.
     * @param vaultId Vault id.
     * @returns Whether a matching author exists.
     */
    public async exists(id: number, vaultId: number): Promise<boolean> {
        const result = await this.db.query("SELECT id FROM authors WHERE id = $1 AND vault_id = $2", [id, vaultId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Deletes an author, scoped to `vaultId`. No-op if it doesn't exist or belongs to someone else.
     * @param id Author id.
     * @param vaultId Vault id.
     */
    public async remove(id: number, vaultId: number): Promise<void> {
        await this.db.query("DELETE FROM authors WHERE id = $1 AND vault_id = $2", [id, vaultId]);
    }
}
