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
     * Lists every category belonging to `userId`.
     * @param userId Owning user's id.
     * @returns Every matching category.
     */
    public async findAll(userId: number): Promise<Category[]> {
        const result = await this.db.query(
            `SELECT id, name FROM categories WHERE user_id = $1`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Looks up one category by id, scoped to `userId`.
     * @param id Category id.
     * @param userId Owning user's id.
     * @returns The category, or null if it doesn't exist or belongs to someone else.
     */
    public async findById(id: number, userId: number): Promise<Category | null> {
        const result = await this.db.query(
            `SELECT categories.id, categories.name
               FROM categories
              WHERE categories.id = $1
                AND categories.user_id = $2`,
            [id, userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Inserts a new category owned by `userId`.
     * @param userId Owning user's id.
     * @param name Category name.
     * @returns The new row's id.
     */
    public async create(userId: number, name: string): Promise<number> {
        const result = await this.db.query(
            "INSERT INTO categories (name, user_id) VALUES ($1, $2) RETURNING id",
            [name, userId]
        );
        return result.rows[0].id;
    }

    /**
     * Renames a category, scoped to `userId`.
     * @param id Category id.
     * @param userId Owning user's id.
     * @param name New name.
     * @returns Rows affected - 0 if `id` doesn't exist or belongs to another user.
     */
    public async rename(id: number, userId: number, name: string): Promise<number> {
        const result = await this.db.query(
            "UPDATE categories SET name = $1 WHERE id = $2 AND user_id = $3",
            [name, id, userId]
        );
        return result.rowCount ?? 0;
    }

    /**
     * Checks whether a category exists and belongs to `userId`.
     * @param id Category id.
     * @param userId Owning user's id.
     * @returns Whether a matching category exists.
     */
    public async exists(id: number, userId: number): Promise<boolean> {
        const result = await this.db.query(
            "SELECT id FROM categories WHERE id = $1 AND user_id = $2",
            [id, userId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Deletes a category, scoped to `userId`. No-op if it doesn't exist or belongs to someone else.
     * @param id Category id.
     * @param userId Owning user's id.
     */
    public async remove(id: number, userId: number): Promise<void> {
        await this.db.query("DELETE FROM categories WHERE id = $1 AND user_id = $2", [id, userId]);
    }
}
