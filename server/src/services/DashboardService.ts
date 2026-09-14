import {Pool} from "pg";
import {DashboardRepository} from "../repositories/DashboardRepository";
import {ReadingStatusEnum} from "../types/book/IReadingStatus";
import {CategoryShelf, CategoryShelfRow, DashboardData} from "../types/dashboard";

/** Business rules for the Dashboard resource: runs DashboardRepository's fan-out of queries and shapes the aggregate response. */
export class DashboardService {
    /**
     * @param pool Database connection pool, forwarded to a fresh DashboardRepository on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Folds the denormalized category/book rows into one entry per category, each carrying its sample of books.
     * @param rows Denormalized (category, sample book) rows from DashboardRepository.getTopCategoryShelfRows.
     * @returns One entry per category, each with its own `books` array.
     */
    private foldCategoryShelves(rows: CategoryShelfRow[]): CategoryShelf[] {
        const byId = new Map<number, CategoryShelf>();
        for (const row of rows) {
            if (!byId.has(row.category_id)) {
                byId.set(row.category_id, {id: row.category_id, name: row.category_name, count: row.count, books: []});
            }
            if (row.book_id !== null) {
                byId.get(row.category_id)!.books.push({id: row.book_id, name: row.book_name!, image_url: row.image_url});
            }
        }
        return Array.from(byId.values());
    }

    /**
     * Builds the full dashboard payload: runs every DashboardRepository query concurrently, then folds/shapes the results.
     * @param userId Owning user's id.
     * @returns The dashboard's KPIs and chart data.
     */
    public async getDashboard(userId: number): Promise<DashboardData> {
        const repo = new DashboardRepository(this.pool);
        const [
            lastBooks,
            totalBooks,
            totalThisMonth,
            totalLastMonth,
            totalCategories,
            totalCustomers,
            booksInTime,
            stockStatus,
            totalBookedBooks,
            totalLocations,
            totalAuthors,
            categoryShelfRows,
            currentlyOnLoan,
            wantToRead,
            currentlyReading,
            totalRead
        ] = await Promise.all([
            repo.findRecentBooks(userId),
            repo.countBooks(userId),
            repo.countBooksThisMonth(userId),
            repo.countBooksLastMonth(userId),
            repo.countCategories(userId),
            repo.countCustomers(userId),
            repo.getBooksPerMonth(userId),
            repo.getStockStatusCounts(userId),
            repo.countBookedBooks(userId),
            repo.countLocations(userId),
            repo.countAuthors(userId),
            repo.getTopCategoryShelfRows(userId),
            repo.getCurrentlyOnLoan(userId),
            repo.findByReadingStatus(userId, ReadingStatusEnum.WANT_TO_READ),
            repo.findByReadingStatus(userId, ReadingStatusEnum.CURRENTLY_READING),
            repo.countByReadingStatus(userId, ReadingStatusEnum.READ),
        ]);

        return {
            lastBooks,
            totalBooks,
            totalThisMonth,
            totalLastMonth,
            totalCategories,
            totalCustomers,
            booksInTime,
            stockStatus,
            totalBookedBooks,
            totalLocations,
            totalAuthors,
            categoryShelves: this.foldCategoryShelves(categoryShelfRows),
            currentlyOnLoan,
            wantToRead,
            currentlyReading,
            totalRead,
        };
    }
}
