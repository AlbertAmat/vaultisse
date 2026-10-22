import {ISearchResponse} from "@vaultisse/types/search/ISearchResponse";
import type {AxiosInstance} from "axios";
import {SearchFilter} from "@vaultisse/types/search/SearchFilter";
import {SortType} from "@vaultisse/types/search/SortType";
import {IBookCounters} from "@vaultisse/types/search/IBookCounters";

/**
 * Thin HTTP client for the `/api/rest/book/search` endpoint (see server/src/routes/BooksRoute.ts).
 *
 * @example
 * const {books, total} = await api.search.searchBooks("hobbit", null, 0, [SearchFilter.HAS_STOCK]);
 */
export class SearchService {

    constructor(private readonly http: AxiosInstance) {}

    /**
     * Paginated, filterable search over the user's books.
     * @param query Free-text match against book name/isbn, or null.
     * @param category_id Restrict to a single category id, or null for all.
     * @param page Zero-based page index (50 results per page).
     * @param filters Extra `SearchFilter` values to narrow by stock availability, loan status or recency.
     * @param sort Sort order, defaults to name (A-Z) on the server if omitted.
     * @param dateFrom Restrict to books added on/after this date (YYYY-MM-DD), or null.
     * @param dateTo Restrict to books added on/before this date (YYYY-MM-DD), or null.
     * @returns A page of matching books plus pagination info.
     */
    public async searchBooks(
        query: string | null,
        category_id: number | null,
        page: number,
        filters: SearchFilter[],
        sort?: SortType | null,
        dateFrom?: string | null,
        dateTo?: string | null
    ): Promise<ISearchResponse> {

        const {data} = await this.http.get(`/book/search`, {
            params: {
                query: query,
                category_id: category_id,
                page: page,
                filters: filters.join(","),
                sort: sort || undefined,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined
            }
        })

        return data;
    }

    /**
     * Lightweight totals for the user's library (all books, recent, on loan,
     * with no stock) - powers the "Library" section of the left nav.
     */
    public async getCounters(): Promise<IBookCounters> {
        const {data} = await this.http.get(`/book/counters`);
        return data;
    }
}
