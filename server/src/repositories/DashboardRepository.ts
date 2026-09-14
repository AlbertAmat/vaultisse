import {Pool, PoolClient} from "pg";
import {ReadingStatusEnum} from "../types/book/IReadingStatus";
import {BooksPerMonth, CategoryShelfRow, CurrentLoan, DashboardBookSummary, StockStatusCount} from "../types/dashboard";

/**
 * Data access for the dashboard's 16-query fan-out. See DashboardService
 * for the `Promise.all` orchestration and response-shaping built on top of
 * this. Every COUNT(*) below is cast from Postgres's bigint-as-string back
 * to a `number` right here, so nothing above this layer needs to know about
 * that quirk.
 */
export class DashboardRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * The 10 most recently added books (last 30 days).
     * @param userId Owning user's id.
     * @returns Up to 10 recent books.
     */
    public async findRecentBooks(userId: number): Promise<DashboardBookSummary[]> {
        const result = await this.db.query(`
            SELECT b.id, b.name, b.image_url, b.isbn, b.pages, b.date_created
              FROM books b
             WHERE b.user_id = $1
               AND b.date_created >= NOW() - INTERVAL '30 days'
             ORDER BY b.date_created DESC
                 LIMIT 10;
        `, [userId]);
        return result.rows;
    }

    /**
     * Total book count.
     * @param userId Owning user's id.
     * @returns The number of books belonging to `userId`.
     */
    public async countBooks(userId: number): Promise<number> {
        const result = await this.db.query(`SELECT COUNT(*) AS count FROM books WHERE user_id = $1`, [userId]);
        return Number(result.rows[0].count);
    }

    /**
     * Book count added this calendar month.
     * @param userId Owning user's id.
     * @returns The number of books added since the start of the current month.
     */
    public async countBooksThisMonth(userId: number): Promise<number> {
        const result = await this.db.query(
            `SELECT COUNT(*) AS count FROM books WHERE user_id = $1 AND date_created >= date_trunc('month', CURRENT_DATE)`,
            [userId]
        );
        return Number(result.rows[0].count);
    }

    /**
     * Book count added last calendar month.
     * @param userId Owning user's id.
     * @returns The number of books added during the previous calendar month.
     */
    public async countBooksLastMonth(userId: number): Promise<number> {
        const result = await this.db.query(
            `SELECT COUNT(*) AS count FROM books
              WHERE user_id = $1
                AND date_created >= date_trunc('month', CURRENT_DATE - interval '1 month')
                AND date_created < date_trunc('month', CURRENT_DATE)`,
            [userId]
        );
        return Number(result.rows[0].count);
    }

    /**
     * Total category count.
     * @param userId Owning user's id.
     * @returns The number of categories belonging to `userId`.
     */
    public async countCategories(userId: number): Promise<number> {
        const result = await this.db.query(`SELECT COUNT(*) AS count FROM categories WHERE user_id = $1`, [userId]);
        return Number(result.rows[0].count);
    }

    /**
     * Total customer count.
     * @param userId Owning user's id.
     * @returns The number of customers belonging to `userId`.
     */
    public async countCustomers(userId: number): Promise<number> {
        const result = await this.db.query(`SELECT COUNT(*) AS count FROM customers WHERE user_id = $1`, [userId]);
        return Number(result.rows[0].count);
    }

    /**
     * Books added, grouped by month, for the dashboard's time-series chart.
     * @param userId Owning user's id.
     * @returns One row per month with at least one book added.
     */
    public async getBooksPerMonth(userId: number): Promise<BooksPerMonth[]> {
        const result = await this.db.query(
            `SELECT date_trunc('month', date_created) AS month, COUNT(*) AS total_books
               FROM books
              WHERE user_id = $1
              GROUP BY month
              ORDER BY month`,
            [userId]
        );
        return result.rows.map((row) => ({...row, total_books: Number(row.total_books)}));
    }

    /**
     * Book-stock counts grouped by status, for the dashboard's stock-status chart.
     * @param userId Owning user's id.
     * @returns One row per stock status present.
     */
    public async getStockStatusCounts(userId: number): Promise<StockStatusCount[]> {
        const result = await this.db.query(
            `SELECT status, COUNT(*) AS count FROM book_stocks WHERE user_id = $1 GROUP BY status`,
            [userId]
        );
        return result.rows.map((row) => ({...row, count: Number(row.count)}));
    }

    /**
     * Count of book stocks currently booked/loaned to a customer.
     * @param userId Owning user's id.
     * @returns The number of book stocks with a customer assigned.
     */
    public async countBookedBooks(userId: number): Promise<number> {
        const result = await this.db.query(
            `SELECT COUNT(*) AS count FROM book_stocks WHERE user_id = $1 AND customer_id IS NOT NULL`,
            [userId]
        );
        return Number(result.rows[0].count);
    }

    /**
     * Total location count.
     * @param userId Owning user's id.
     * @returns The number of locations belonging to `userId`.
     */
    public async countLocations(userId: number): Promise<number> {
        const result = await this.db.query(`SELECT COUNT(*) AS count FROM locations WHERE user_id = $1`, [userId]);
        return Number(result.rows[0].count);
    }

    /**
     * Total author count.
     * @param userId Owning user's id.
     * @returns The number of authors belonging to `userId`.
     */
    public async countAuthors(userId: number): Promise<number> {
        const result = await this.db.query(`SELECT COUNT(*) AS count FROM authors WHERE user_id = $1`, [userId]);
        return Number(result.rows[0].count);
    }

    /**
     * Top 6 categories by book count, each denormalized into one row per
     * (category, sample book) pair - up to 10 of its most recently added books.
     * Fold into one entry per category with DashboardService.foldCategoryShelves.
     *
     * @param userId Owning user's id.
     * @returns The denormalized category/book rows.
     */
    public async getTopCategoryShelfRows(userId: number): Promise<CategoryShelfRow[]> {
        const result = await this.db.query(`
            WITH top_categories AS (
                SELECT c.id, c.name, COUNT(b.id) AS count
                  FROM categories c
                           LEFT JOIN books b ON b.category_id = c.id AND b.user_id = c.user_id
                 WHERE c.user_id = $1
                 GROUP BY c.id, c.name
                 ORDER BY count DESC, c.name ASC
                     LIMIT 6
            ),
                 ranked_books AS (
                     SELECT b.id, b.name, b.image_url, b.category_id,
                            ROW_NUMBER() OVER (PARTITION BY b.category_id ORDER BY b.date_created DESC) AS rn
                       FROM books b
                      WHERE b.user_id = $1
                        AND b.category_id IN (SELECT id FROM top_categories)
                 )
            SELECT tc.id AS category_id, tc.name AS category_name, tc.count,
                   rb.id AS book_id, rb.name AS book_name, rb.image_url
              FROM top_categories tc
                       LEFT JOIN ranked_books rb ON rb.category_id = tc.id AND rb.rn <= 10
             ORDER BY tc.count DESC, tc.name, rb.rn
        `, [userId]);
        return result.rows.map((row) => ({...row, count: Number(row.count)}));
    }

    /**
     * The 5 most recent active loans, with who they're loaned to.
     * @param userId Owning user's id.
     * @returns Up to 5 current loans.
     */
    public async getCurrentlyOnLoan(userId: number): Promise<CurrentLoan[]> {
        const result = await this.db.query(`
            SELECT b.id AS "bookId", b.name AS "bookName", b.image_url AS "imageUrl",
                   c.id AS "customerId", c.name AS "customerName"
              FROM book_stocks bs
                       JOIN books b ON b.id = bs.book_id AND b.user_id = bs.user_id
                       JOIN customers c ON c.id = bs.customer_id AND c.user_id = bs.user_id
             WHERE bs.user_id = $1
               AND bs.status = 2
             ORDER BY bs.id DESC
                 LIMIT 5
        `, [userId]);
        return result.rows;
    }

    /**
     * The 10 most recently updated books with a given reading status.
     * @param userId Owning user's id.
     * @param status Reading status to filter by.
     * @returns Up to 10 matching books.
     */
    public async findByReadingStatus(userId: number, status: ReadingStatusEnum): Promise<DashboardBookSummary[]> {
        const result = await this.db.query(
            `SELECT b.id, b.name, b.image_url, b.isbn
               FROM books b
              WHERE b.user_id = $1
                AND b.reading_status = $2
              ORDER BY b.date_updated DESC
                  LIMIT 10`,
            [userId, status]
        );
        return result.rows;
    }

    /**
     * Total book count with a given reading status.
     * @param userId Owning user's id.
     * @param status Reading status to filter by.
     * @returns The number of matching books.
     */
    public async countByReadingStatus(userId: number, status: ReadingStatusEnum): Promise<number> {
        const result = await this.db.query(
            `SELECT COUNT(*) AS count FROM books WHERE user_id = $1 AND reading_status = $2`,
            [userId, status]
        );
        return Number(result.rows[0].count);
    }
}
