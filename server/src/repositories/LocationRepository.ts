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
     * Lists every location belonging to `userId`, each with its current book count.
     * @param userId Owning user's id.
     * @returns Every matching location.
     */
    public async findAll(userId: number): Promise<Location[]> {
        const result = await this.db.query(
            `SELECT id,
                    name,
                    description,
                    "default",
                    (SELECT COUNT(*) FROM book_stocks WHERE book_stocks.location_id = locations.id) total_books
               FROM locations
              WHERE user_id = $1
              ORDER BY id`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Looks up one location by id, scoped to `userId`.
     * @param id Location id.
     * @param userId Owning user's id.
     * @returns The location, or null if it doesn't exist or belongs to someone else.
     */
    public async findById(id: number | string, userId: number): Promise<Location | null> {
        const result = await this.db.query(
            `SELECT locations.id,
                    locations.name,
                    locations.description,
                    locations."default",
                    (SELECT COUNT(*) FROM book_stocks WHERE book_stocks.location_id = locations.id) total_books
               FROM locations
              WHERE locations.id = $1
                AND locations.user_id = $2`,
            [id, userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Inserts a new location owned by `userId`.
     * @param userId Owning user's id.
     * @param name Location name.
     * @param description Location description.
     * @returns The new row's id.
     */
    public async create(userId: number, name: string, description: string): Promise<number> {
        const result = await this.db.query(
            "INSERT INTO locations (name, description, user_id) VALUES ($1, $2, $3) RETURNING id",
            [name, description, userId]
        );
        return result.rows[0].id;
    }

    /**
     * Renames/redescribes a location, scoped to `userId`.
     * @param id Location id.
     * @param userId Owning user's id.
     * @param name New name.
     * @param description New description.
     * @returns Rows affected - 0 if `id` doesn't exist or belongs to another user.
     */
    public async rename(id: string, userId: number, name: string, description: string): Promise<number> {
        const result = await this.db.query(
            `UPDATE locations SET name = $1, description = $2 WHERE id = $3 AND user_id = $4`,
            [name, description, id, userId]
        );
        return result.rowCount ?? 0;
    }

    /**
     * Checks whether a location exists and belongs to `userId`.
     * @param id Location id.
     * @param userId Owning user's id.
     * @returns Whether a matching location exists.
     */
    public async exists(id: number, userId: number): Promise<boolean> {
        const result = await this.db.query("SELECT id FROM locations WHERE id = $1 AND user_id = $2", [id, userId]);
        return result.rowCount === 1;
    }

    /**
     * Deletes a location, scoped to `userId`. No-op if it doesn't exist or belongs to someone else.
     * @param id Location id.
     * @param userId Owning user's id.
     */
    public async remove(id: number, userId: number): Promise<void> {
        await this.db.query("DELETE FROM locations WHERE id = $1 AND user_id = $2", [id, userId]);
    }

    /**
     * The books (with stock code/status) currently stored at `locationId` - no ownership check, matches the original route.
     * @param locationId Location id.
     * @param userId Owning user's id.
     * @returns Every book stock at that location.
     */
    public async getBooks(locationId: number, userId: number): Promise<LocationBook[]> {
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
                AND book_stocks.user_id = $2
                AND books.user_id = $2`,
            [locationId, userId]
        );
        return result.rows;
    }

    /**
     * Moves one book stock into `locationId`. Silently no-ops if `stockCode` doesn't exist or isn't owned by `userId` - matches the original route.
     * @param locationId Destination location id.
     * @param userId Owning user's id.
     * @param stockCode Book stock code to move.
     */
    public async moveBookStock(locationId: number, userId: number, stockCode: string): Promise<void> {
        await this.db.query(
            "UPDATE book_stocks SET location_id = $1 WHERE code = $2 AND user_id = $3",
            [locationId, stockCode, userId]
        );
    }

    /**
     * Unsets `default` on every one of `userId`'s locations - used before setting a new default so only one can ever be true.
     * @param userId Owning user's id.
     */
    public async clearDefault(userId: number): Promise<void> {
        await this.db.query('UPDATE locations SET "default" = FALSE WHERE user_id = $1', [userId]);
    }

    /**
     * Sets `default` on one location, scoped to `userId`.
     * @param id Location id.
     * @param userId Owning user's id.
     */
    public async setDefault(id: number, userId: number): Promise<void> {
        await this.db.query('UPDATE locations SET "default" = TRUE WHERE id = $1 AND user_id = $2', [id, userId]);
    }
}
