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
     * @param vaultId Vault id.
     * @returns Every author belonging to `vaultId`.
     */
    public async listAuthors(vaultId: number): Promise<Author[]> {
        return new AuthorRepository(this.pool).findAll(vaultId);
    }

    /**
     * Case-insensitive author search for the autocomplete/picker.
     * @param vaultId Vault id.
     * @param query Substring to search for.
     * @returns Every matching author.
     */
    public async searchAuthors(vaultId: number, query: string): Promise<Author[]> {
        return new AuthorRepository(this.pool).search(vaultId, query);
    }

    /**
     * Creates an author and returns the freshly-created row.
     * @param vaultId Vault id.
     * @param name Author name.
     * @returns The newly-created author.
     */
    public async createAuthor(vaultId: number, name: string): Promise<Author> {
        const repo = new AuthorRepository(this.pool);
        const id = await repo.create(vaultId, name);
        const author = await repo.findById(id, vaultId);
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
     * @param vaultId Vault id.
     * @param name New name.
     * @returns The renamed author.
     */
    public async renameAuthor(id: string, vaultId: number, name: string): Promise<Author> {
        const repo = new AuthorRepository(this.pool);
        const rowsAffected = await repo.rename(id, vaultId, name);
        if (rowsAffected !== 1) {
            throw new Error("Author rename affected an unexpected number of rows");
        }
        const author = await repo.findById(id, vaultId);
        if (!author) {
            throw new Error("Author not found after rename");
        }
        return author;
    }

    /**
     * Deletes an author, throwing NotFoundError if it doesn't belong to the caller.
     * @param id Author id.
     * @param vaultId Vault id.
     */
    public async deleteAuthor(id: number, vaultId: number): Promise<void> {
        const repo = new AuthorRepository(this.pool);
        const found = await repo.exists(id, vaultId);
        if (!found) {
            throw new NotFoundError("Author not found");
        }
        await repo.remove(id, vaultId);
    }
}
