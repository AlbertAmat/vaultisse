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
     * @param vaultId Vault id.
     * @returns Up to 10 recent books.
     */
    public async findRecentBooks(vaultId: number): Promise<DashboardBookSummary[]> {
        const result = await this.db.query(`
            SELECT b.id, b.name, b.image_url, b.isbn, b.pages, b.date_created
              FROM books b
             WHERE b.vault_id = $1
               AND b.date_created >= NOW() - INTERVAL '30 days'
             ORDER BY b.date_created DESC
                 LIMIT 10;
        `, [vaultId]);
        return result.rows;
    }

    /**
     * Total book count.
     * @param vaultId Vault id.
     * @returns The number of books belonging to `vaultId`.
     */
    public async countBooks(vaultId: number): Promise<number> {
        const result = await this.db.query(`SELECT COUNT(*) AS count FROM books WHERE vault_id = $1`, [vaultId]);
        return Number(result.rows[0].count);
    }

    /**
     * Book count added this calendar month.
     * @param vaultId Vault id.
     * @returns The number of books added since the start of the current month.
     */
    public async countBooksThisMonth(vaultId: number): Promise<number> {
        const result = await this.db.query(
            `SELECT COUNT(*) AS count FROM books WHERE vault_id = $1 AND date_created >= date_trunc('month', CURRENT_DATE)`,
            [vaultId]
        );
        return Number(result.rows[0].count);
    }

    /**
     * Book count added last calendar month.
     * @param vaultId Vault id.
     * @returns The number of books added during the previous calendar month.
     */
    public async countBooksLastMonth(vaultId: number): Promise<number> {
        const result = await this.db.query(
            `SELECT COUNT(*) AS count FROM books
              WHERE vault_id = $1
                AND date_created >= date_trunc('month', CURRENT_DATE - interval '1 month')
                AND date_created < date_trunc('month', CURRENT_DATE)`,
            [vaultId]
        );
        return Number(result.rows[0].count);
    }

    /**
     * Total category count.
     * @param vaultId Vault id.
     * @returns The number of categories belonging to `vaultId`.
     */
    public async countCategories(vaultId: number): Promise<number> {
        const result = await this.db.query(`SELECT COUNT(*) AS count FROM categories WHERE vault_id = $1`, [vaultId]);
        return Number(result.rows[0].count);
    }

    /**
     * Total customer count.
     * @param vaultId Vault id.
     * @returns The number of customers belonging to `vaultId`.
     */
    public async countCustomers(vaultId: number): Promise<number> {
        const result = await this.db.query(`SELECT COUNT(*) AS count FROM customers WHERE vault_id = $1`, [vaultId]);
        return Number(result.rows[0].count);
    }

    /**
     * Books added, grouped by month, for the dashboard's time-series chart.
     * @param vaultId Vault id.
     * @returns One row per month with at least one book added.
     */
    public async getBooksPerMonth(vaultId: number): Promise<BooksPerMonth[]> {
        const result = await this.db.query(
            `SELECT date_trunc('month', date_created) AS month, COUNT(*) AS total_books
               FROM books
              WHERE vault_id = $1
              GROUP BY month
              ORDER BY month`,
            [vaultId]
        );
        return result.rows.map((row) => ({...row, total_books: Number(row.total_books)}));
    }

    /**
     * Book-stock counts grouped by status, for the dashboard's stock-status chart.
     * @param vaultId Vault id.
     * @returns One row per stock status present.
     */
    public async getStockStatusCounts(vaultId: number): Promise<StockStatusCount[]> {
        const result = await this.db.query(
            `SELECT status, COUNT(*) AS count FROM book_stocks WHERE vault_id = $1 GROUP BY status`,
            [vaultId]
        );
        return result.rows.map((row) => ({...row, count: Number(row.count)}));
    }

    /**
     * Count of book stocks currently booked/loaned to a customer.
     * @param vaultId Vault id.
     * @returns The number of book stocks with a customer assigned.
     */
    public async countBookedBooks(vaultId: number): Promise<number> {
        const result = await this.db.query(
            `SELECT COUNT(*) AS count FROM book_stocks WHERE vault_id = $1 AND customer_id IS NOT NULL`,
            [vaultId]
        );
        return Number(result.rows[0].count);
    }

    /**
     * Total location count.
     * @param vaultId Vault id.
     * @returns The number of locations belonging to `vaultId`.
     */
    public async countLocations(vaultId: number): Promise<number> {
        const result = await this.db.query(`SELECT COUNT(*) AS count FROM locations WHERE vault_id = $1`, [vaultId]);
        return Number(result.rows[0].count);
    }

    /**
     * Total author count.
     * @param vaultId Vault id.
     * @returns The number of authors belonging to `vaultId`.
     */
    public async countAuthors(vaultId: number): Promise<number> {
        const result = await this.db.query(`SELECT COUNT(*) AS count FROM authors WHERE vault_id = $1`, [vaultId]);
        return Number(result.rows[0].count);
    }

    /**
     * Top 6 categories by book count, each denormalized into one row per
     * (category, sample book) pair - up to 10 of its most recently added books.
     * Fold into one entry per category with DashboardService.foldCategoryShelves.
     *
     * @param vaultId Vault id.
     * @returns The denormalized category/book rows.
     */
    public async getTopCategoryShelfRows(vaultId: number): Promise<CategoryShelfRow[]> {
        const result = await this.db.query(`
            WITH top_categories AS (
                SELECT c.id, c.name, COUNT(b.id) AS count
                  FROM categories c
                           LEFT JOIN books b ON b.category_id = c.id AND b.vault_id = c.vault_id
                 WHERE c.vault_id = $1
                 GROUP BY c.id, c.name
                 ORDER BY count DESC, c.name ASC
                     LIMIT 6
            ),
                 ranked_books AS (
                     SELECT b.id, b.name, b.image_url, b.category_id,
                            ROW_NUMBER() OVER (PARTITION BY b.category_id ORDER BY b.date_created DESC) AS rn
                       FROM books b
                      WHERE b.vault_id = $1
                        AND b.category_id IN (SELECT id FROM top_categories)
                 )
            SELECT tc.id AS category_id, tc.name AS category_name, tc.count,
                   rb.id AS book_id, rb.name AS book_name, rb.image_url
              FROM top_categories tc
                       LEFT JOIN ranked_books rb ON rb.category_id = tc.id AND rb.rn <= 10
             ORDER BY tc.count DESC, tc.name, rb.rn
        `, [vaultId]);
        return result.rows.map((row) => ({...row, count: Number(row.count)}));
    }

    /**
     * The 5 most recent active loans, with who they're loaned to.
     * @param vaultId Vault id.
     * @returns Up to 5 current loans.
     */
    public async getCurrentlyOnLoan(vaultId: number): Promise<CurrentLoan[]> {
        const result = await this.db.query(`
            SELECT b.id AS "bookId", b.name AS "bookName", b.image_url AS "imageUrl",
                   c.id AS "customerId", c.name AS "customerName"
              FROM book_stocks bs
                       JOIN books b ON b.id = bs.book_id AND b.vault_id = bs.vault_id
                       JOIN customers c ON c.id = bs.customer_id AND c.vault_id = bs.vault_id
             WHERE bs.vault_id = $1
               AND bs.status = 2
             ORDER BY bs.id DESC
                 LIMIT 5
        `, [vaultId]);
        return result.rows;
    }

    /**
     * The 10 most recently updated books with a given reading status.
     * @param vaultId Vault id.
     * @param status Reading status to filter by.
     * @returns Up to 10 matching books.
     */
    public async findByReadingStatus(vaultId: number, status: ReadingStatusEnum): Promise<DashboardBookSummary[]> {
        const result = await this.db.query(
            `SELECT b.id, b.name, b.image_url, b.isbn
               FROM books b
              WHERE b.vault_id = $1
                AND b.reading_status = $2
              ORDER BY b.date_updated DESC
                  LIMIT 10`,
            [vaultId, status]
        );
        return result.rows;
    }

    /**
     * Total book count with a given reading status.
     * @param vaultId Vault id.
     * @param status Reading status to filter by.
     * @returns The number of matching books.
     */
    public async countByReadingStatus(vaultId: number, status: ReadingStatusEnum): Promise<number> {
        const result = await this.db.query(
            `SELECT COUNT(*) AS count FROM books WHERE vault_id = $1 AND reading_status = $2`,
            [vaultId, status]
        );
        return Number(result.rows[0].count);
    }
}
