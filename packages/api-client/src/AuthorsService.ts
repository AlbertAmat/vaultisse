import IBookAuthor from "@vaultisse/types/book/IBookAuthor";
import type {AxiosInstance} from "axios";

/**
 * Thin HTTP client for the `/api/rest/author` endpoints (see server/src/routes/AuthorRoute.ts).
 *
 * @example
 * await api.authors.addAuthor("J.R.R. Tolkien");
 * const matches = await api.authors.searchAuthors("tolk");
 */
export class AuthorsService {

    constructor(private readonly http: AxiosInstance) {}

    /**
     * Case-insensitive substring search over the user's authors, for the
     * author picker/autocomplete when editing a book.
     * @param query Search text, e.g. "tolk".
     * @returns Matching authors.
     */
    public async searchAuthors(query: string): Promise<IBookAuthor[]> {
        const {data} = await this.http.post(`/author/search`, {
            query: query
        });
        return data;
    }

    /** @returns Every author belonging to the user. */
    public async getAuthors(): Promise<IBookAuthor[]> {
        const {data} = await this.http.get(`/author`)
        return data;
    }

    /**
     * Rename an existing author.
     * @param id Author id to update.
     * @param name New author name.
     */
    public async updateAuthor(id: number, name: string) {
        await this.http.put(`/author/${id}`, {
            name: name,
        })
    }

    /**
     * Create a new author and return the created record.
     * @param name New author's name.
     * @returns The created author.
     */
    public async addAuthor(name: string): Promise<IBookAuthor> {
        const {data} = await this.http.post(`/author`, {
            name: name,
        })

        return data;
    }

    /**
     * Delete an author by id.
     * @param id Author id to delete.
     */
    public async deleteAuthor(id: number): Promise<void> {
        await this.http.delete(`/author/${id}`)
    }

}
