import {Pool} from "pg";
import {CategoryRepository} from "../repositories/CategoryRepository";
import {Category} from "../types/category";
import {NotFoundError} from "../errors/DomainError";

/** Business rules for the Category resource. Calls CategoryRepository; throws DomainError subclasses for expected failures. */
export class CategoryService {
    /**
     * @param pool Database connection pool, forwarded to a fresh CategoryRepository on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Lists the caller's categories.
     * @param vaultId Vault id.
     * @returns Every category belonging to `vaultId`.
     */
    public async listCategories(vaultId: number): Promise<Category[]> {
        return new CategoryRepository(this.pool).findAll(vaultId);
    }

    /**
     * Creates a category and returns the freshly-created row.
     * @param vaultId Vault id.
     * @param name Category name.
     * @returns The newly-created category.
     */
    public async createCategory(vaultId: number, name: string): Promise<Category> {
        const repo = new CategoryRepository(this.pool);
        const id = await repo.create(vaultId, name);
        const category = await repo.findById(id, vaultId);
        if (!category) {
            throw new NotFoundError("Category not found after creation");
        }
        return category;
    }

    /**
     * Renames a category.
     *
     * NOTE: intentionally does not verify the rename actually matched a row
     * before re-fetching - this preserves the original route's existing
     * behavior (see server/test/routes/CategoriesRoute.test.ts's "keeps
     * categories private to the user who created them" test, which asserts
     * renaming another user's category currently 500s rather than 404s).
     * Fixing that is a legitimate follow-up, but out of scope for this
     * structural refactor - flagging here rather than changing behavior
     * silently. Throws a plain Error (not NotFoundError) so the controller's
     * generic catch-all still produces the same 500 as before.
     *
     * @param id Category id.
     * @param vaultId Vault id.
     * @param name New name.
     * @returns The renamed category.
     */
    public async renameCategory(id: number, vaultId: number, name: string): Promise<Category> {
        const repo = new CategoryRepository(this.pool);
        await repo.rename(id, vaultId, name);
        const category = await repo.findById(id, vaultId);
        if (!category) {
            throw new Error("Category not found after rename");
        }
        return category;
    }

    /**
     * Deletes a category, throwing NotFoundError if it doesn't belong to the caller.
     * @param id Category id.
     * @param vaultId Vault id.
     */
    public async deleteCategory(id: number, vaultId: number): Promise<void> {
        const repo = new CategoryRepository(this.pool);
        const found = await repo.exists(id, vaultId);
        if (!found) {
            throw new NotFoundError("Category not found");
        }
        await repo.remove(id, vaultId);
    }
}
