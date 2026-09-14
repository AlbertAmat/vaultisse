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
     * Lists every author belonging to `userId`.
     * @param userId Owning user's id.
     * @returns Every matching author.
     */
    public async findAll(userId: number): Promise<Author[]> {
        const result = await this.db.query(
            `SELECT id, name FROM authors WHERE user_id = $1`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Case-insensitive substring search by name, for the author autocomplete/picker.
     * @param userId Owning user's id.
     * @param query Substring to search for, case-insensitive.
     * @returns Every matching author.
     */
    public async search(userId: number, query: string): Promise<Author[]> {
        const result = await this.db.query(
            `SELECT authors.id, authors.name
               FROM authors
              WHERE LOWER(authors.name) ILIKE $1
                AND authors.user_id = $2`,
            [`%${query.toLocaleLowerCase()}%`, userId]
        );
        return result.rows;
    }

    /**
     * Looks up one author by id, scoped to `userId`.
     * @param id Author id.
     * @param userId Owning user's id.
     * @returns The author, or null if it doesn't exist or belongs to someone else.
     */
    public async findById(id: number | string, userId: number): Promise<Author | null> {
        const result = await this.db.query(
            `SELECT authors.id, authors.name
               FROM authors
              WHERE authors.id = $1
                AND authors.user_id = $2`,
            [id, userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Inserts a new author owned by `userId`.
     * @param userId Owning user's id.
     * @param name Author name.
     * @returns The new row's id.
     */
    public async create(userId: number, name: string): Promise<number> {
        const result = await this.db.query(
            "INSERT INTO authors (name, user_id) VALUES ($1, $2) RETURNING id",
            [name, userId]
        );
        return result.rows[0].id;
    }

    /**
     * Renames an author, scoped to `userId`.
     * @param id Author id.
     * @param userId Owning user's id.
     * @param name New name.
     * @returns Rows affected - 0 if `id` doesn't exist or belongs to another user.
     */
    public async rename(id: string, userId: number, name: string): Promise<number> {
        const result = await this.db.query(
            "UPDATE authors SET name = $1 WHERE id = $2 AND user_id = $3",
            [name, id, userId]
        );
        return result.rowCount ?? 0;
    }

    /**
     * Checks whether an author exists and belongs to `userId`. Also used by BookService to validate an incoming `authorId`.
     * @param id Author id.
     * @param userId Owning user's id.
     * @returns Whether a matching author exists.
     */
    public async exists(id: number, userId: number): Promise<boolean> {
        const result = await this.db.query("SELECT id FROM authors WHERE id = $1 AND user_id = $2", [id, userId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Deletes an author, scoped to `userId`. No-op if it doesn't exist or belongs to someone else.
     * @param id Author id.
     * @param userId Owning user's id.
     */
    public async remove(id: number, userId: number): Promise<void> {
        await this.db.query("DELETE FROM authors WHERE id = $1 AND user_id = $2", [id, userId]);
    }
}
