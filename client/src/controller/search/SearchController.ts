/**
 * Backs the book search/library view: paginated, filterable search with an
 * "infinite scroll"-style `fetchBooks(clear)` that either replaces the
 * current results (new query/filter) or appends the next page. The initial
 * search text comes from the `query` route param (see `SearchRoute`).
 */
import {BaseController} from "@/controller/BaseController";
import {api} from "@/plugins/api";
import {ref, Ref, shallowRef, ShallowRef, watch} from "vue";
import BookItem from "@/model/book/BookItem";
import {ISearchResponse} from "@vaultisse/types/search/ISearchResponse";
import router from "@/router/Router";
import {SearchRoute} from "@/router/routes/SearchRoute";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {SearchFilter} from "@vaultisse/types/search/SearchFilter";
import {SortType} from "@vaultisse/types/search/SortType";

export default class SearchController extends BaseController<ISearchResponse> {

    /** Zero-based index of the currently loaded page. */
    private m_page: Ref<number> = ref(0);

    /** Total number of books matching the current search, across all pages. */
    private m_totalBooks: Ref<number> = ref(0);

    /** Currently active `SearchFilter` values. */
    private m_filters: Ref<SearchFilter[]> = ref([]);

    /** Current sort order. */
    private m_sort: Ref<SortType> = ref(SortType.NAME_ASC);

    /** Restrict to books added on/after this date (YYYY-MM-DD), or null. */
    private m_dateFrom: Ref<string | null> = ref(null);

    /** Restrict to books added on/before this date (YYYY-MM-DD), or null. */
    private m_dateTo: Ref<string | null> = ref(null);

    /** Restrict to books in this category, or null for every category. */
    private m_categoryId: Ref<number | null> = ref(null);

    /** Whether the results are currently rendered grouped by category (UI-only, not sent to the server). */
    private m_groupByCategory: Ref<boolean> = ref(false);

    /** Number of results per page, as reported by the server. */
    private m_limit: number = 0;

    /** Books loaded so far for the current query/filters. */
    private m_books: ShallowRef<BookItem[]>;

    public constructor() {
        super(i18n.global.t(AppLabels.LIBRARY));
        this.m_books = shallowRef([]);

        // Pick up any `SearchFilter`(s)/date range passed in the route (e.g. a
        // deep link from the "Library" nav's quick filters, or the global
        // filter menu in AppBar.vue navigating here from another page) so the
        // filter chips reflect it immediately - `fetchData()` above already
        // used the same route params for the actual initial fetch.
        const params = router.currentRoute.value.query;
        const filtersParam = params[SearchRoute.FILTERS_QUERY_PARAM];
        if (filtersParam) {
            this.m_filters.value = String(filtersParam).split(",") as SearchFilter[];
        }
        const dateFromParam = params[SearchRoute.DATE_FROM_QUERY_PARAM];
        const dateToParam = params[SearchRoute.DATE_TO_QUERY_PARAM];
        this.m_dateFrom.value = dateFromParam ? String(dateFromParam) : null;
        this.m_dateTo.value = dateToParam ? String(dateToParam) : null;
        const categoryParam = params[SearchRoute.CATEGORY_QUERY_PARAM];
        this.m_categoryId.value = categoryParam ? Number(categoryParam) : null;

        // These route params can also be a plain router-link to this same
        // route with different values (quick filters, the global filter menu)
        // - since Vue Router reuses this already-mounted view/controller
        // instance rather than remounting it, apply the new values whenever
        // they change instead of only once at construction time.
        watch(() => router.currentRoute.value.query[SearchRoute.FILTERS_QUERY_PARAM], (newFiltersParam) => {
            this.m_filters.value = newFiltersParam ? String(newFiltersParam).split(",") as SearchFilter[] : [];
            this.m_page.value = 0;
            this.fetchBooks(true);
        });

        watch(
            () => [router.currentRoute.value.query[SearchRoute.DATE_FROM_QUERY_PARAM], router.currentRoute.value.query[SearchRoute.DATE_TO_QUERY_PARAM]],
            ([newDateFrom, newDateTo]) => {
                this.m_dateFrom.value = newDateFrom ? String(newDateFrom) : null;
                this.m_dateTo.value = newDateTo ? String(newDateTo) : null;
                this.m_page.value = 0;
                this.fetchBooks(true);
            }
        );

        watch(() => router.currentRoute.value.query[SearchRoute.CATEGORY_QUERY_PARAM], (newCategoryParam) => {
            this.m_categoryId.value = newCategoryParam ? Number(newCategoryParam) : null;
            this.m_page.value = 0;
            this.fetchBooks(true);
        });
    }

    /**
     * @returns The first page of results for the route's initial `query`/`category`/`filters` params.
     * Note: this runs during the base class's constructor (before this class's own field
     * initializers have executed - see the JS "fields init right after `super()`" rule), so it must
     * derive everything it needs from the route directly rather than reading `this.m_*` fields.
     */
    async fetchData(): Promise<ISearchResponse> {
        const params = router.currentRoute.value.query;
        const query = params[SearchRoute.QUERY_PARAM] ? params[SearchRoute.QUERY_PARAM] as string : null;
        const categoryId = params[SearchRoute.CATEGORY_QUERY_PARAM] ? Number(params[SearchRoute.CATEGORY_QUERY_PARAM]) : null;
        const filtersParam = params[SearchRoute.FILTERS_QUERY_PARAM];
        const filters = filtersParam ? String(filtersParam).split(",") as SearchFilter[] : [];
        const dateFromParam = params[SearchRoute.DATE_FROM_QUERY_PARAM];
        const dateToParam = params[SearchRoute.DATE_TO_QUERY_PARAM];

        return await api.search.searchBooks(
            query,
            categoryId,
            0,
            filters,
            SortType.NAME_ASC,
            dateFromParam ? String(dateFromParam) : null,
            dateToParam ? String(dateToParam) : null
        )
    }

    /** @param data Raw search response from the server, or null. */
    setData(data: ISearchResponse | null) {
        if(data) {
            this.m_totalBooks.value = data.total;
            this.m_limit = data.limit;
            this.m_books.value = data.books.map((book) => new BookItem(book));
        }
    }

    /**
     * Re-run the search for the current query/page/filters.
     * @param clear If true, replace the current results (new search/filter
     * change); if false/omitted, append to them (loading the next page).
     */
    public async fetchBooks(clear?: boolean) {
        try {
            const params = router.currentRoute.value.query;
            const query = params[SearchRoute.QUERY_PARAM] ? params[SearchRoute.QUERY_PARAM] as string : null;
            const data = await api.search.searchBooks(
                query,
                this.m_categoryId.value,
                this.m_page.value,
                this.m_filters.value,
                this.m_sort.value,
                this.m_dateFrom.value,
                this.m_dateTo.value
            );

            if(clear) {
                this.m_books.value = data.books.map((book) => new BookItem(book));
            } else {
                this.m_books.value = [...this.m_books.value, ...data.books.map((book) => new BookItem(book))];
            }
        } catch (e) {
            console.log("Error while fetching books", e)
        }
    }

    /** @returns The total number of books matching the current search. */
    public getTotalBooks(): number {
        return this.m_totalBooks.value;
    }

    /** @returns The number of results per page. */
    public getLimit(): number {
        return this.m_limit;
    }

    /** @returns The zero-based index of the currently loaded page. */
    public getPage(): number {
        return this.m_page.value;
    }

    /** @returns Whether there is a page before the current one. */
    public hasPreviousPage(): boolean {
        return this.m_page.value > 0;
    }

    /** Decrement the current page index, if there is a previous page. */
    public prevPage() {
        if(this.hasPreviousPage()) {
            return this.m_page.value--;
        }
    }

    /** @returns Whether there are more results beyond the currently loaded page(s). */
    public hasNextPage():boolean {
        return this.m_totalBooks.value > (this.m_page.value + 1) * this.m_limit;
    }

    /** Increment the current page index. */
    public nextPage() {
        return this.m_page.value++;
    }

    /** @param page New zero-based page index. */
    public setPage(page: number) {
        return this.m_page.value = page;
    }

    /** @returns Whether any books are currently loaded. */
    public hasBooks(): boolean {
        return this.m_books.value.length > 0;
    }

    /** @returns The books loaded so far for the current query/filters. */
    public getBooks(): BookItem[] {
        return this.m_books.value;
    }

    /** @returns The currently active search filters. */
    public getFilters(): SearchFilter[] {
        return this.m_filters.value;
    }

    /**
     * Enable a search filter, reset to page 0, and re-run the search from scratch.
     * @param filter Filter to add.
     */
    public addFilter(filter: SearchFilter) {
        if(!this.m_filters.value.includes(filter)) {
            this.m_filters.value.push(filter)
            this.m_page.value = 0;
            this.fetchBooks(true);
        }
    }

    /**
     * Disable a search filter, reset to page 0, and re-run the search from scratch.
     * @param filter Filter to remove.
     */
    public removeFilter(filter: SearchFilter) {
        if(this.m_filters.value.includes(filter)) {
            this.m_filters.value.splice(this.m_filters.value.indexOf(filter), 1);
            this.m_filters.value = [...this.m_filters.value];
            this.m_page.value = 0;
            this.fetchBooks(true);
        }
    }

    /** @returns The currently active sort order. */
    public getSort(): SortType {
        return this.m_sort.value;
    }

    /**
     * Change the sort order, reset to page 0, and re-run the search from scratch.
     * @param sort New sort order.
     */
    public setSort(sort: SortType) {
        if(this.m_sort.value !== sort) {
            this.m_sort.value = sort;
            this.m_page.value = 0;
            this.fetchBooks(true);
        }
    }

    /** @returns The active "added on/after" date filter (YYYY-MM-DD), or null. */
    public getDateFrom(): string | null {
        return this.m_dateFrom.value;
    }

    /** @returns The active "added on/before" date filter (YYYY-MM-DD), or null. */
    public getDateTo(): string | null {
        return this.m_dateTo.value;
    }

    /** @returns Whether an upload-date range filter is currently active. */
    public hasDateRange(): boolean {
        return this.m_dateFrom.value !== null || this.m_dateTo.value !== null;
    }

    /**
     * Set the upload-date range filter, reset to page 0, and re-run the search from scratch.
     * @param from "Added on/after" date (YYYY-MM-DD), or null to leave unbounded.
     * @param to "Added on/before" date (YYYY-MM-DD), or null to leave unbounded.
     */
    public setDateRange(from: string | null, to: string | null) {
        this.m_dateFrom.value = from;
        this.m_dateTo.value = to;
        this.m_page.value = 0;
        this.fetchBooks(true);
    }

    /** Clear the upload-date range filter, reset to page 0, and re-run the search from scratch. */
    public clearDateRange() {
        this.setDateRange(null, null);
    }

    /** @returns The active category filter, or null if every category is shown. */
    public getCategoryId(): number | null {
        return this.m_categoryId.value;
    }

    /**
     * Change the category filter, reset to page 0, and re-run the search from scratch.
     * @param categoryId New category id to restrict to, or null to clear it.
     */
    public setCategoryId(categoryId: number | null) {
        if (this.m_categoryId.value !== categoryId) {
            this.m_categoryId.value = categoryId;
            this.m_page.value = 0;
            this.fetchBooks(true);
        }
    }

    /** Clear the category filter, reset to page 0, and re-run the search from scratch. */
    public clearCategoryId() {
        this.setCategoryId(null);
    }

    /** @returns Whether any filter, upload-date range or category is currently active. */
    public hasActiveFilters(): boolean {
        return this.m_filters.value.length > 0 || this.hasDateRange() || this.m_categoryId.value !== null;
    }

    /** @returns Whether results are currently rendered grouped by category. */
    public getGroupByCategory(): boolean {
        return this.m_groupByCategory.value;
    }

    /** @param value New "group by category" state - purely a display toggle, doesn't affect the query. */
    public setGroupByCategory(value: boolean) {
        this.m_groupByCategory.value = value;
    }
}

/**
 * The currently mounted `BooksSearchView`'s controller, or null when that
 * view isn't mounted. `AppBar.vue` isn't a descendant of the search view (both
 * are siblings under the app layout, so `provide`/`inject` can't bridge them) -
 * this module-level ref is the shared handle it uses to show/drive the
 * filters menu docked in the global search box only while the library page
 * is actually on screen. Set/cleared by `BooksSearchView.vue` on mount/unmount.
 *
 * Must be a `shallowRef`, not `ref`: a plain `ref()` holding a class instance
 * deeply reactive-wraps it, and Vue's reactive-object ref-unwrapping then
 * makes every `this.m_*` field inside the controller's own methods resolve to
 * the field's already-unwrapped value instead of the `Ref` itself (so
 * `this.m_filters.value` breaks - `this.m_filters` is no longer a `Ref`).
 * `shallowRef` keeps the instance itself un-proxied, so its methods behave
 * exactly as if called directly on `model`.
 */
export const activeSearchController: ShallowRef<SearchController | null> = shallowRef(null);
