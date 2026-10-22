import type {AxiosInstance} from "axios";
import ICategory from "@vaultisse/types/category/ICategory";

/**
 * Thin HTTP client for the `/api/rest/category` endpoints (see server/src/routes/CategoriesRoute.ts).
 *
 * @example
 * const categories = await api.categories.getCategories();
 * const created = await api.categories.addCategory("Fantasy");
 */
export class CategoriesService {

    constructor(private readonly http: AxiosInstance) {}

    /** @returns Every category belonging to the user. */
    public async getCategories(): Promise<ICategory[]> {
        const {data} = await this.http.get(`/category`)
        return data;
    }

    /**
     * Rename an existing category.
     * @param id Category id to update.
     * @param name New category name.
     */
    public async updateCategory(id: number, name: string) {
        await this.http.put(`/category/${id}`, {
            name: name,
        })
    }

    /**
     * Create a new category and return the created record.
     * @param name New category's name.
     * @returns The created category.
     */
    public async addCategory(name: string): Promise<ICategory> {
        const {data} = await this.http.post(`/category`, {
            name: name,
        })

        return data;
    }

    /**
     * Delete a category by id.
     * @param id Category id to delete.
     */
    public async deleteCategory(id: number): Promise<void> {
        await this.http.delete(`/category/${id}`)
    }
}
