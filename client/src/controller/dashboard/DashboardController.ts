// Import the base controller to inherit common controller functionality
import { BaseController } from "@/controller/BaseController";

// Types for the dashboard data
import IDashboard, {
    IBooksInTime,
    IDashboardBook,
    IDashboardCategoryShelf,
    IDashboardLoan,
    IDashboardStockSatuts
} from "@vaultisse/types/dashboard/IDashboard";

// Service to fetch dashboard-related data
import { dashboardService } from "@/service/dashboard/DashboardService";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

/**
 * Controller class responsible for fetching and holding
 * the dashboard data used throughout the UI.
 */
export default class DashboardController extends BaseController<IDashboard> {

    /**
     * Recently added books displayed on the dashboard.
     * @private
     */
    private m_lastBooks: IDashboardBook[] = [];

    /**
     * Total number of books in the system.
     * @private
     */
    private m_totalBooks: number = 0;

    /**
     * Number of books added in the current month.
     * @private
     */
    private m_totalThisMonth: number = 0;

    /**
     * Number of books added in the previous month.
     * @private
     */
    private m_totalLastMonth: number = 0;

    /**
     * Total number of categories in the system.
     * @private
     */
    private m_totalCategories: number = 0;

    /**
     * Total number of customers registered.
     * @private
     */
    private m_totalCustomers: number = 0;

    /**
     * Total number of books currently booked/reserved.
     * @private
     */
    private m_totalBookedBooks: number = 0;

    /**
     * Total number of physical locations (e.g., branches or stores).
     * @private
     */
    private m_totalLocations: number = 0;

    /**
     * Total number of authors in the system.
     * @private
     */
    private m_totalAuthors: number = 0;

    /**
     * Time-series data of books added over time.
     * @private
     */
    private m_booksInTime: IBooksInTime[] = [];

    /**
     * Summary of stock statuses for all books.
     * @private
     */
    private m_stockStatus: IDashboardStockSatuts[] = [];

    /**
     * Top categories by book count, each with a sample of its books, for the
     * dashboard's category pills and "browse by category" shelves.
     * @private
     */
    private m_categoryShelves: IDashboardCategoryShelf[] = [];

    /**
     * Books currently on loan, with who they're loaned to.
     * @private
     */
    private m_currentlyOnLoan: IDashboardLoan[] = [];

    /**
     * Books on the user's "want to read" shelf.
     * @private
     */
    private m_wantToRead: IDashboardBook[] = [];

    /**
     * Books on the user's "currently reading" shelf.
     * @private
     */
    private m_currentlyReading: IDashboardBook[] = [];

    /**
     * Total number of books marked as read.
     * @private
     */
    private m_totalRead: number = 0;

    /**
     * Constructor initializes the controller with the identifier "Dashboard".
     */
    public constructor() {
        super(i18n.global.t(AppLabels.DASHBOARD));
    }

    /**
     * Fetches the dashboard data from the backend service.
     * @returns A promise resolving to the dashboard data.
     */
    async fetchData(): Promise<IDashboard> {
        return await dashboardService.getData();
    }

    /**
     * Populates the controller state with the fetched dashboard data.
     * @param data - The dashboard data object retrieved from the service.
     */
    setData(data: IDashboard) {
        this.m_lastBooks = data.lastBooks;
        this.m_totalBooks = data.totalBooks;
        this.m_totalThisMonth = data.totalThisMonth;
        this.m_totalLastMonth = data.totalLastMonth;
        this.m_totalCategories = data.totalCategories;
        this.m_totalCustomers = data.totalCustomers;
        this.m_totalLocations = data.totalLocations;
        this.m_totalBookedBooks = data.totalBookedBooks;
        this.m_booksInTime = data.booksInTime;
        this.m_stockStatus = data.stockStatus;
        this.m_totalAuthors = data.totalAuthors;
        this.m_categoryShelves = data.categoryShelves;
        this.m_currentlyOnLoan = data.currentlyOnLoan;
        this.m_wantToRead = data.wantToRead;
        this.m_currentlyReading = data.currentlyReading;
        this.m_totalRead = data.totalRead;
    }

    /**
     * Returns the list of most recently added books.
     */
    public getLastBooks() {
        return this.m_lastBooks;
    }

    /**
     * Returns the total number of books.
     */
    public getTotalBooks() {
        return this.m_totalBooks;
    }

    /**
     * Returns the number of books added this month.
     */
    public getTotalThisMonth() {
        return this.m_totalThisMonth;
    }

    /**
     * Returns the number of books added last month.
     */
    public getTotalLastMonth() {
        return this.m_totalLastMonth;
    }

    /**
     * Returns the total number of authors.
     */
    public getTotalAuthors(): number {
        return this.m_totalAuthors;
    }

    /**
     * Returns the total number of categories.
     */
    public getTotalCategories() {
        return this.m_totalCategories;
    }

    /**
     * Returns the total number of physical locations.
     */
    public getTotalLocations() {
        return this.m_totalLocations;
    }

    /**
     * Returns the total number of registered customers.
     */
    public getTotalCustomers() {
        return this.m_totalCustomers;
    }

    /**
     * Returns the total number of booked/reserved books.
     */
    public getTotalBookedBooks() {
        return this.m_totalBookedBooks;
    }

    /**
     * Returns time-series data for books added over time.
     */
    public getBooksInTime() {
        return this.m_booksInTime;
    }

    /**
     * Returns the stock status data for all books.
     */
    public getStockStatus() {
        return this.m_stockStatus;
    }

    /**
     * Returns the top categories by book count, each with a sample of its books.
     */
    public getCategoryShelves() {
        return this.m_categoryShelves;
    }

    /**
     * Returns the books currently on loan, with who they're loaned to.
     */
    public getCurrentlyOnLoan() {
        return this.m_currentlyOnLoan;
    }

    /**
     * Returns the books on the user's "want to read" shelf.
     */
    public getWantToRead() {
        return this.m_wantToRead;
    }

    /**
     * Returns the books on the user's "currently reading" shelf.
     */
    public getCurrentlyReading() {
        return this.m_currentlyReading;
    }

    /**
     * Returns the total number of books marked as read.
     */
    public getTotalRead() {
        return this.m_totalRead;
    }

}