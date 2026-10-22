/**
 * Backs the Loans management view: a paginated, filterable (by customer
 * group and loan date range) list of books currently on loan, with a
 * `returnLoan` action that bulk-returns a single copy and refreshes the list.
 */
import {BaseController} from "@/controller/BaseController";
import ILoansResponse, {ILoan} from "@vaultisse/types/loans/ILoan";
import {api} from "@/plugins/api";
import {ICustomerGroup} from "@vaultisse/types/customer/ICustomerGroup";
import {ICustomerDetail} from "@vaultisse/types/customer/ICustomer";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {ref, Ref} from "vue";

export default class LoansController extends BaseController<ILoansResponse> {

    /** Loans loaded for the current page/filters. */
    private m_loans: ILoan[] = [];

    /** Total number of loans matching the current filters, across all pages. */
    private m_total: number = 0;

    /** Number of results per page, as reported by the server. */
    private m_limit: number = 0;

    /** Zero-based index of the currently loaded page. */
    private m_page: number = 0;

    /** Currently active customer group filter, or null for all groups. */
    private m_groupId: number | null = null;

    /** Currently active "loaned on/after" filter ("YYYY-MM-DD"), or null. */
    private m_dateFrom: string | null = null;

    /** Currently active "loaned on/before" filter ("YYYY-MM-DD"), or null. */
    private m_dateTo: string | null = null;

    /** Every customer group, for the group filter dropdown. */
    private m_groups: Ref<ICustomerGroup[]> = ref([]);

    /** Every customer, for the report dialog's customer filter. */
    private m_customers: Ref<ICustomerDetail[]> = ref([]);

    /** Stock codes currently being returned, so their row can show a loading state. */
    private m_returning: Ref<string[]> = ref([]);

    public constructor() {
        super(i18n.global.t(AppLabels.LOANS));
        api.customerGroups.getGroups().then((groups) => this.m_groups.value = groups);
        api.customers.getPageData().then((data) => this.m_customers.value = data.customers);
    }

    /** @returns The first page of loans for the current filters. */
    async fetchData(): Promise<ILoansResponse> {
        return await api.loans.getLoans(this.m_page, this.m_groupId, this.m_dateFrom, this.m_dateTo);
    }

    /** @param data Raw loans response from the server, or null. */
    setData(data: ILoansResponse | null) {
        this.m_loans = data ? data.loans : [];
        this.m_total = data ? data.total : 0;
        this.m_limit = data ? data.limit : 0;
    }

    /** Re-run the query for the current page/filters. */
    public refresh() {
        return this.__fetchData();
    }

    /** @returns The loans loaded for the current page/filters. */
    public getLoans(): ILoan[] {
        return this.m_loans;
    }

    /** @returns The total number of loans matching the current filters. */
    public getTotal(): number {
        return this.m_total;
    }

    /** @returns The number of results per page. */
    public getLimit(): number {
        return this.m_limit;
    }

    /** @returns The zero-based index of the currently loaded page. */
    public getPage(): number {
        return this.m_page;
    }

    /** @returns Whether there is a page before the current one. */
    public hasPreviousPage(): boolean {
        return this.m_page > 0;
    }

    /** @returns Whether there are more results beyond the current page. */
    public hasNextPage(): boolean {
        return this.m_total > (this.m_page + 1) * this.m_limit;
    }

    /** Go to the given zero-based page and re-run the query. */
    public setPage(page: number) {
        this.m_page = page;
        return this.refresh();
    }

    /** @returns Every customer group, for the group filter dropdown. */
    public getGroups(): ICustomerGroup[] {
        return this.m_groups.value;
    }

    /** @returns Every customer, for the report dialog's customer filter. */
    public getCustomers(): ICustomerDetail[] {
        return this.m_customers.value;
    }

    /** @returns The currently active customer group filter, or null for all groups. */
    public getGroupFilter(): number | null {
        return this.m_groupId;
    }

    /** Set the customer group filter, reset to page 0, and re-run the query. */
    public setGroupFilter(groupId: number | null) {
        this.m_groupId = groupId;
        this.m_page = 0;
        return this.refresh();
    }

    /** @returns The currently active "loaned on/after" filter, or null. */
    public getDateFrom(): string | null {
        return this.m_dateFrom;
    }

    /** @returns The currently active "loaned on/before" filter, or null. */
    public getDateTo(): string | null {
        return this.m_dateTo;
    }

    /** Set the loan date range filter, reset to page 0, and re-run the query. */
    public setDateRange(dateFrom: string | null, dateTo: string | null) {
        this.m_dateFrom = dateFrom;
        this.m_dateTo = dateTo;
        this.m_page = 0;
        return this.refresh();
    }

    /** @returns Stock codes currently being returned. */
    public getReturning(): string[] {
        return this.m_returning.value;
    }

    /**
     * Return a single loaned copy and refresh the list.
     * @param stockCode The copy's book_stocks.code.
     */
    public async returnLoan(stockCode: string) {
        this.m_returning.value.push(stockCode);
        try {
            await api.books.returnBooks([stockCode]);
            await this.refresh();
        } finally {
            this.m_returning.value.splice(this.m_returning.value.indexOf(stockCode), 1);
        }
    }
}
