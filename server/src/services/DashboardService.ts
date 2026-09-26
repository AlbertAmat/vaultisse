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
     * @param vaultId Vault id.
     * @returns The dashboard's KPIs and chart data.
     */
    public async getDashboard(vaultId: number): Promise<DashboardData> {
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
            repo.findRecentBooks(vaultId),
            repo.countBooks(vaultId),
            repo.countBooksThisMonth(vaultId),
            repo.countBooksLastMonth(vaultId),
            repo.countCategories(vaultId),
            repo.countCustomers(vaultId),
            repo.getBooksPerMonth(vaultId),
            repo.getStockStatusCounts(vaultId),
            repo.countBookedBooks(vaultId),
            repo.countLocations(vaultId),
            repo.countAuthors(vaultId),
            repo.getTopCategoryShelfRows(vaultId),
            repo.getCurrentlyOnLoan(vaultId),
            repo.findByReadingStatus(vaultId, ReadingStatusEnum.WANT_TO_READ),
            repo.findByReadingStatus(vaultId, ReadingStatusEnum.CURRENTLY_READING),
            repo.countByReadingStatus(vaultId, ReadingStatusEnum.READ),
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
