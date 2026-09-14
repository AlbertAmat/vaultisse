import {Pool, PoolClient} from "pg";
import {Loan, LoanHistoryRow, LoanListFilter, LoanReportFilter} from "../types/loan";

/** Data access for currently-on-loan `book_stocks` rows and the `loan_history` ledger. See LoanService for the business rules built on top of this. */
export class LoanRepository {
    /** Page size for `list`. */
    public static readonly MAX_ROWS = 50;

    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Lists books currently on loan (`book_stocks.status = 2`), paginated and optionally filtered by customer group/date range.
     * @param userId Owning user's id.
     * @param filter Pagination and optional group/date-range filters.
     * @returns The total matching row count (across all pages) and this page's rows.
     */
    public async list(userId: number, filter: LoanListFilter): Promise<{total: number; loans: Loan[]}> {
        const page = Math.max(0, filter.page ?? 0);
        const skip = LoanRepository.MAX_ROWS * page;

        const params: any[] = [userId];
        const conditions: string[] = [
            `bs.user_id = $1`,
            `bs.status = 2`
        ];

        if (filter.groupId) {
            conditions.push(`cg.id = $${params.push(filter.groupId)}`);
        }
        if (filter.dateFrom) {
            conditions.push(`bs.loaned_at >= $${params.push(filter.dateFrom)}::date`);
        }
        if (filter.dateTo) {
            conditions.push(`bs.loaned_at < $${params.push(filter.dateTo)}::date + INTERVAL '1 day'`);
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const fromClause = `
            FROM book_stocks bs
                     JOIN books b ON b.id = bs.book_id AND b.user_id = bs.user_id
                     JOIN customers c ON c.id = bs.customer_id AND c.user_id = bs.user_id
                     LEFT JOIN customer_groups cg ON cg.id = c.group_id AND cg.user_id = bs.user_id
        `;

        const totalResult = await this.db.query(`SELECT COUNT(*) ${fromClause} ${whereClause}`, params);

        const result = await this.db.query(
            `SELECT bs.id           AS "stockId",
                    bs.code         AS "stockCode",
                    bs.loaned_at    AS "loanedAt",
                    b.id            AS "bookId",
                    b.name          AS "bookName",
                    b.image_url     AS "imageUrl",
                    c.id            AS "customerId",
                    c.name          AS "customerName",
                    cg.id           AS "groupId",
                    cg.name         AS "groupName"
             ${fromClause}
             ${whereClause}
             ORDER BY bs.loaned_at DESC NULLS LAST, bs.id DESC
                 LIMIT ${LoanRepository.MAX_ROWS}
             OFFSET ${skip}`,
            params
        );

        return {total: Number(totalResult.rows[0].count), loans: result.rows};
    }

    /**
     * Unpaginated `loan_history` export for a date range, optionally filtered by customer group/customer, for the Loans view's Excel report.
     * @param userId Owning user's id.
     * @param filter Required date range and optional group/customer filters.
     * @returns Every matching loan-history row.
     */
    public async report(userId: number, filter: LoanReportFilter): Promise<LoanHistoryRow[]> {
        const params: any[] = [userId, filter.dateFrom, filter.dateTo];
        const conditions: string[] = [
            `user_id = $1`,
            `loaned_at >= $2::date`,
            `loaned_at < $3::date + INTERVAL '1 day'`
        ];

        if (filter.groupId) {
            conditions.push(`group_id = $${params.push(filter.groupId)}`);
        }
        if (filter.customerId) {
            conditions.push(`customer_id = $${params.push(filter.customerId)}`);
        }

        const result = await this.db.query(
            `SELECT book_name     AS "bookName",
                    stock_code    AS "stockCode",
                    customer_name AS "customerName",
                    group_name    AS "groupName",
                    loaned_at     AS "loanedAt",
                    returned_at   AS "returnedAt"
             FROM loan_history
             WHERE ${conditions.join(' AND ')}
             ORDER BY loaned_at DESC`,
            params
        );

        return result.rows;
    }
}
