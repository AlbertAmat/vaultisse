import {Pool} from "pg";
import {AuthorRepository} from "../repositories/AuthorRepository";
import {Author} from "../types/author";
import {NotFoundError} from "../errors/DomainError";

/** Business rules for the Author resource. Calls AuthorRepository; throws DomainError subclasses for expected failures. */
export class AuthorService {
    /**
     * @param pool Database connection pool, forwarded to a fresh AuthorRepository on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Lists the caller's authors.
     * @param userId Owning user's id.
     * @returns Every author belonging to `userId`.
     */
    public async listAuthors(userId: number): Promise<Author[]> {
        return new AuthorRepository(this.pool).findAll(userId);
    }

    /**
     * Case-insensitive author search for the autocomplete/picker.
     * @param userId Owning user's id.
     * @param query Substring to search for.
     * @returns Every matching author.
     */
    public async searchAuthors(userId: number, query: string): Promise<Author[]> {
        return new AuthorRepository(this.pool).search(userId, query);
    }

    /**
     * Creates an author and returns the freshly-created row.
     * @param userId Owning user's id.
     * @param name Author name.
     * @returns The newly-created author.
     */
    public async createAuthor(userId: number, name: string): Promise<Author> {
        const repo = new AuthorRepository(this.pool);
        const id = await repo.create(userId, name);
        const author = await repo.findById(id, userId);
        if (!author) {
            throw new NotFoundError("Author not found after creation");
        }
        return author;
    }

    /**
     * Renames an author.
     *
     * Preserves the original route's existing behavior: a rename that matches
     * zero rows (nonexistent id, or belongs to another user) is a plain 500,
     * not a 404 - see AuthorRoute's original `if (queryResult.rowCount != 1)`
     * check. Throws a plain Error (not a DomainError) so the controller's
     * generic catch-all produces that same 500.
     *
     * @param id Author id.
     * @param userId Owning user's id.
     * @param name New name.
     * @returns The renamed author.
     */
    public async renameAuthor(id: string, userId: number, name: string): Promise<Author> {
        const repo = new AuthorRepository(this.pool);
        const rowsAffected = await repo.rename(id, userId, name);
        if (rowsAffected !== 1) {
            throw new Error("Author rename affected an unexpected number of rows");
        }
        const author = await repo.findById(id, userId);
        if (!author) {
            throw new Error("Author not found after rename");
        }
        return author;
    }

    /**
     * Deletes an author, throwing NotFoundError if it doesn't belong to the caller.
     * @param id Author id.
     * @param userId Owning user's id.
     */
    public async deleteAuthor(id: number, userId: number): Promise<void> {
        const repo = new AuthorRepository(this.pool);
        const found = await repo.exists(id, userId);
        if (!found) {
            throw new NotFoundError("Author not found");
        }
        await repo.remove(id, userId);
    }
}
