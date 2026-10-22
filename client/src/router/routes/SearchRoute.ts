import {ARoute} from "@/router/ARoute";
import {SearchFilter} from "@vaultisse/types/search/SearchFilter";

/** Route to the book search/library view (`/app/library/search`), with an optional preset query string. */
export class SearchRoute extends ARoute {

    /** Vue Router path pattern for this route. */
    public static PATH = "/library/search";

    /** Route name shown in Vue Router config. */
    private m_name: string = "Library";

    /** Query string param name the search view reads its initial search text from. */
    public static QUERY_PARAM = "query";

    /** Query string param name the search view reads its initial category filter from. */
    public static CATEGORY_QUERY_PARAM = "category";

    /** Query string param name the search view reads its initial `SearchFilter`(s) from (comma-separated). */
    public static FILTERS_QUERY_PARAM = "filters";

    /** Query string param name the search view reads its initial "added on/after" date filter from (YYYY-MM-DD). */
    public static DATE_FROM_QUERY_PARAM = "date_from";

    /** Query string param name the search view reads its initial "added on/before" date filter from (YYYY-MM-DD). */
    public static DATE_TO_QUERY_PARAM = "date_to";

    /** @returns The Vue Router route config for the search/library view. */
    public getRoute() {
        return  {
            name: this.m_name,
            path: SearchRoute.PATH,
            component: () => import('@/views/search/BooksSearchView.vue'),
        }
    }

    /**
     * @param query Optional initial search text, appended as `?query=...`.
     * @returns The navigable URL for the search/library view.
     */
    public getPath(query?: string) {
        if (query) {
            return `${SearchRoute.PATH}?${SearchRoute.QUERY_PARAM}=${encodeURIComponent(query)}`;
        }
        return SearchRoute.PATH;
    }

    /**
     * @param categoryId Category id to pre-filter the search/library view by.
     * @returns The navigable URL for the search/library view, filtered to that category.
     */
    public getPathForCategory(categoryId: number) {
        return `${SearchRoute.PATH}?${SearchRoute.CATEGORY_QUERY_PARAM}=${categoryId}`;
    }

    /**
     * @param filter `SearchFilter` to pre-filter the search/library view by.
     * @returns The navigable URL for the search/library view, pre-filtered.
     */
    public getPathForFilter(filter: SearchFilter) {
        return `${SearchRoute.PATH}?${SearchRoute.FILTERS_QUERY_PARAM}=${filter}`;
    }

    /**
     * Build the search/library view URL from any combination of filters/date
     * range/category - used by the global filter menu (see `SearchToolbarFilterMenu.vue`)
     * to jump there pre-filtered from any other page.
     * @param options `filters`, `categoryId` and/or `dateFrom`/`dateTo` (YYYY-MM-DD) to apply; any omitted/empty/null one is left out of the URL entirely.
     */
    public getPathForFilters(options: { filters?: SearchFilter[]; dateFrom?: string | null; dateTo?: string | null; categoryId?: number | null }) {
        const params = new URLSearchParams();

        if (options.filters && options.filters.length > 0) {
            params.set(SearchRoute.FILTERS_QUERY_PARAM, options.filters.join(","));
        }
        if (options.categoryId) {
            params.set(SearchRoute.CATEGORY_QUERY_PARAM, String(options.categoryId));
        }
        if (options.dateFrom) {
            params.set(SearchRoute.DATE_FROM_QUERY_PARAM, options.dateFrom);
        }
        if (options.dateTo) {
            params.set(SearchRoute.DATE_TO_QUERY_PARAM, options.dateTo);
        }

        const queryString = params.toString();
        return queryString ? `${SearchRoute.PATH}?${queryString}` : SearchRoute.PATH;
    }
}

/** Singleton instance used throughout the app for navigation. */
export const searchRoute = new SearchRoute();
