export interface DashboardBookSummary {
    id: number;
    name: string;
    image_url: string | null;
    isbn: string | null;
    pages?: number | null;
    date_created?: string;
}

export interface BooksPerMonth {
    month: string;
    total_books: number;
}

export interface StockStatusCount {
    status: number;
    count: number;
}

/** One denormalized row per (top category, sample book) pair - fold with foldCategoryShelves in DashboardService. */
export interface CategoryShelfRow {
    category_id: number;
    category_name: string;
    count: number;
    book_id: number | null;
    book_name: string | null;
    image_url: string | null;
}

export interface CategoryShelf {
    id: number;
    name: string;
    count: number;
    books: {id: number; name: string; image_url: string | null}[];
}

export interface CurrentLoan {
    bookId: number;
    bookName: string;
    imageUrl: string | null;
    customerId: number;
    customerName: string;
}

export interface DashboardData {
    lastBooks: DashboardBookSummary[];
    totalBooks: number;
    totalThisMonth: number;
    totalLastMonth: number;
    totalCategories: number;
    totalCustomers: number;
    booksInTime: BooksPerMonth[];
    stockStatus: StockStatusCount[];
    totalBookedBooks: number;
    totalLocations: number;
    totalAuthors: number;
    categoryShelves: CategoryShelf[];
    currentlyOnLoan: CurrentLoan[];
    wantToRead: DashboardBookSummary[];
    currentlyReading: DashboardBookSummary[];
    totalRead: number;
}
