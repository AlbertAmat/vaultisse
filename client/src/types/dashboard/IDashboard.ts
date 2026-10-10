import {BookStockStatusEnum} from "@/types/book/IBookStock";

/**
 * Aggregate response shape for `GET /dashboard`, powering the dashboard
 * view's KPI tiles and charts.
 *
 * @example
 * const d: IDashboard = {
 *   lastBooks: [], totalBooks: 42, totalThisMonth: 3, totalLastMonth: 5,
 *   totalCategories: 6, totalCustomers: 10, totalLocations: 2, totalBookedBooks: 5,
 *   totalAuthors: 15, booksInTime: [], stockStatus: [], categoryShelves: [], currentlyOnLoan: []
 * };
 */
export default interface IDashboard {
    /** Most recently added books. */
    lastBooks: IDashboardBook[];
    /** Total number of books. */
    totalBooks: number;
    /** Number of books added this calendar month. */
    totalThisMonth: number;
    /** Number of books added last calendar month. */
    totalLastMonth: number;
    /** Total number of categories. */
    totalCategories: number;
    /** Total number of customers. */
    totalCustomers: number;
    /** Total number of locations. */
    totalLocations: number;
    /** Total number of books currently booked/loaned out. */
    totalBookedBooks: number;
    /** Total number of authors. */
    totalAuthors: number;
    /** Number of books added per month, for the "books over time" chart. */
    booksInTime: IBooksInTime[];
    /** Count of book stocks grouped by lifecycle status. */
    stockStatus: IDashboardStockSatuts[];
    /** Top categories by book count, most-populated first, each with a sample of its most recent books - for the dashboard's category pills and "browse by category" shelves. */
    categoryShelves: IDashboardCategoryShelf[];
    /** Books currently on loan, with who they're loaned to. */
    currentlyOnLoan: IDashboardLoan[];
    /** Books on the user's "want to read" shelf, most recently updated first. */
    wantToRead: IDashboardBook[];
    /** Books on the user's "currently reading" shelf, most recently updated first. */
    currentlyReading: IDashboardBook[];
    /** Total number of books marked as read. */
    totalRead: number;
}

/** A category with a sample of its books, for the dashboard's category pills and shelves. */
export interface IDashboardCategoryShelf {
    /** Category id. */
    id: number;
    /** Category name. */
    name: string;
    /** Total number of books in this category. */
    count: number;
    /** Sample of the category's most recently added books (up to 10). */
    books: IDashboardShelfBook[];
}

/** Minimal book fields shown in a dashboard cover shelf. */
export interface IDashboardShelfBook {
    /** Book id. */
    id: number;
    /** Book title. */
    name: string;
    /** Cover image URL/data-URI, or null if none. */
    image_url: string | null;
}

/** One book currently on loan, for the dashboard's "currently on loan" list. */
export interface IDashboardLoan {
    /** Book id. */
    bookId: number;
    /** Book title. */
    bookName: string;
    /** Cover image URL/data-URI, or null if none. */
    imageUrl: string | null;
    /** Customer id, or null when loaned to a vault member. */
    customerId: number | null;
    /** Vault member's user id, or null when loaned to a customer. */
    memberUserId: number | null;
    /** Customer or vault member name. */
    customerName: string;
}

/** Count of book stocks grouped by lifecycle status, for the stock-status chart. */
export interface IDashboardStockSatuts {
    /** Stock lifecycle status (0: available, 1: not available, 2: booked, 3: damaged). */
    status: BookStockStatusEnum;
    /** Number of stocks with this status. */
    count: number;
}

/** Number of books created in a given month, for the "books over time" chart. */
export interface IBooksInTime {
    /** Month start, ISO string (e.g., "2025-08-01T00:00:00.000Z"). */
    month: string;
    /** Number of books created in that month. */
    total_books: number;
}

/** Minimal book fields shown in the dashboard's "recently added" list. */
export interface IDashboardBook {
    /** Book id. */
    id: number;
    /** Book title. */
    name: string;
    /** Cover image URL/data-URI, or null if none. */
    image_url: string | null;
    /** ISBN code, or null if none. */
    isbn: string | null;
}
