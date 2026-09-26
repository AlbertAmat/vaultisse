import {Pool, PoolClient} from "pg";
import {Location, LocationBook} from "../types/location";

/** Data access for the `locations` table and book_stocks placement. See LocationService for the business rules built on top of this. */
export class LocationRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Lists every location belonging to `vaultId`, each with its current book count.
     * @param vaultId Vault id.
     * @returns Every matching location.
     */
    public async findAll(vaultId: number): Promise<Location[]> {
        const result = await this.db.query(
            `SELECT id,
                    name,
                    description,
                    "default",
                    (SELECT COUNT(*) FROM book_stocks WHERE book_stocks.location_id = locations.id) total_books
               FROM locations
              WHERE vault_id = $1
              ORDER BY id`,
            [vaultId]
        );
        return result.rows;
    }

    /**
     * Looks up one location by id, scoped to `vaultId`.
     * @param id Location id.
     * @param vaultId Vault id.
     * @returns The location, or null if it doesn't exist or belongs to someone else.
     */
    public async findById(id: number | string, vaultId: number): Promise<Location | null> {
        const result = await this.db.query(
            `SELECT locations.id,
                    locations.name,
                    locations.description,
                    locations."default",
                    (SELECT COUNT(*) FROM book_stocks WHERE book_stocks.location_id = locations.id) total_books
               FROM locations
              WHERE locations.id = $1
                AND locations.vault_id = $2`,
            [id, vaultId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Inserts a new location owned by `vaultId`.
     * @param vaultId Vault id.
     * @param name Location name.
     * @param description Location description.
     * @returns The new row's id.
     */
    public async create(vaultId: number, name: string, description: string): Promise<number> {
        const result = await this.db.query(
            "INSERT INTO locations (name, description, vault_id) VALUES ($1, $2, $3) RETURNING id",
            [name, description, vaultId]
        );
        return result.rows[0].id;
    }

    /**
     * Renames/redescribes a location, scoped to `vaultId`.
     * @param id Location id.
     * @param vaultId Vault id.
     * @param name New name.
     * @param description New description.
     * @returns Rows affected - 0 if `id` doesn't exist or belongs to another vault.
     */
    public async rename(id: string, vaultId: number, name: string, description: string): Promise<number> {
        const result = await this.db.query(
            `UPDATE locations SET name = $1, description = $2 WHERE id = $3 AND vault_id = $4`,
            [name, description, id, vaultId]
        );
        return result.rowCount ?? 0;
    }

    /**
     * Checks whether a location exists and belongs to `vaultId`.
     * @param id Location id.
     * @param vaultId Vault id.
     * @returns Whether a matching location exists.
     */
    public async exists(id: number, vaultId: number): Promise<boolean> {
        const result = await this.db.query("SELECT id FROM locations WHERE id = $1 AND vault_id = $2", [id, vaultId]);
        return result.rowCount === 1;
    }

    /**
     * Deletes a location, scoped to `vaultId`. No-op if it doesn't exist or belongs to someone else.
     * @param id Location id.
     * @param vaultId Vault id.
     */
    public async remove(id: number, vaultId: number): Promise<void> {
        await this.db.query("DELETE FROM locations WHERE id = $1 AND vault_id = $2", [id, vaultId]);
    }

    /**
     * The books (with stock code/status) currently stored at `locationId` - no ownership check, matches the original route.
     * @param locationId Location id.
     * @param vaultId Vault id.
     * @returns Every book stock at that location.
     */
    public async getBooks(locationId: number, vaultId: number): Promise<LocationBook[]> {
        const result = await this.db.query(
            `SELECT book_stocks.id,
                    books.name,
                    books.id as book_id,
                    book_stocks.code,
                    book_stocks.status,
                    books.image_url
               FROM book_stocks, books
              WHERE book_stocks.location_id = $1
                AND book_stocks.book_id = books.id
                AND book_stocks.vault_id = $2
                AND books.vault_id = $2`,
            [locationId, vaultId]
        );
        return result.rows;
    }

    /**
     * Moves one book stock into `locationId`. Silently no-ops if `stockCode` doesn't exist or isn't owned by `vaultId` - matches the original route.
     * @param locationId Destination location id.
     * @param vaultId Vault id.
     * @param stockCode Book stock code to move.
     */
    public async moveBookStock(locationId: number, vaultId: number, stockCode: string): Promise<void> {
        await this.db.query(
            "UPDATE book_stocks SET location_id = $1 WHERE code = $2 AND vault_id = $3",
            [locationId, stockCode, vaultId]
        );
    }

    /**
     * Unsets `default` on every one of `vaultId`'s locations - used before setting a new default so only one can ever be true.
     * @param vaultId Vault id.
     */
    public async clearDefault(vaultId: number): Promise<void> {
        await this.db.query('UPDATE locations SET "default" = FALSE WHERE vault_id = $1', [vaultId]);
    }

    /**
     * Sets `default` on one location, scoped to `vaultId`.
     * @param id Location id.
     * @param vaultId Vault id.
     */
    public async setDefault(id: number, vaultId: number): Promise<void> {
        await this.db.query('UPDATE locations SET "default" = TRUE WHERE id = $1 AND vault_id = $2', [id, vaultId]);
    }
}
