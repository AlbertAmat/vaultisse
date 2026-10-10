import {Pool, PoolClient} from "pg";
import {Loan, LoanHistoryRow, LoanListFilter, LoanReportFilter, MyLoan, MyLoanHistoryRow} from "../types/loan";

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
     * @param vaultId Vault id.
     * @param filter Pagination and optional group/date-range filters.
     * @returns The total matching row count (across all pages) and this page's rows.
     */
    public async list(vaultId: number, filter: LoanListFilter): Promise<{total: number; loans: Loan[]}> {
        const page = Math.max(0, filter.page ?? 0);
        const skip = LoanRepository.MAX_ROWS * page;

        const params: any[] = [vaultId];
        const conditions: string[] = [
            `bs.vault_id = $1`,
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
                     JOIN books b ON b.id = bs.book_id AND b.vault_id = bs.vault_id
                     LEFT JOIN customers c ON c.id = bs.customer_id AND c.vault_id = bs.vault_id
                     LEFT JOIN users u ON u.id = bs.member_user_id
                     LEFT JOIN customer_groups cg ON cg.id = c.group_id AND cg.vault_id = bs.vault_id
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
                    u.id            AS "memberUserId",
                    COALESCE(c.name, u.name) AS "customerName",
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
     * @param vaultId Vault id.
     * @param filter Required date range and optional group/customer filters.
     * @returns Every matching loan-history row.
     */
    public async report(vaultId: number, filter: LoanReportFilter): Promise<LoanHistoryRow[]> {
        const params: any[] = [vaultId, filter.dateFrom, filter.dateTo];
        const conditions: string[] = [
            `lh.vault_id = $1`,
            `lh.loaned_at >= $2::date`,
            `lh.loaned_at < $3::date + INTERVAL '1 day'`
        ];

        if (filter.groupId) {
            conditions.push(`lh.group_id = $${params.push(filter.groupId)}`);
        }
        if (filter.customerId) {
            conditions.push(`lh.customer_id = $${params.push(filter.customerId)}`);
        }
        if (filter.memberUserId) {
            conditions.push(`lh.member_user_id = $${params.push(filter.memberUserId)}`);
        }

        const result = await this.db.query(
            `SELECT lh.book_name   AS "bookName",
                    lh.stock_code  AS "stockCode",
                    COALESCE(c.name, u.name) AS "customerName",
                    cg.name        AS "groupName",
                    lh.loaned_at   AS "loanedAt",
                    lh.returned_at AS "returnedAt"
             FROM loan_history lh
                      LEFT JOIN customers c ON c.id = lh.customer_id
                      LEFT JOIN users u ON u.id = lh.member_user_id
                      LEFT JOIN customer_groups cg ON cg.id = lh.group_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY lh.loaned_at DESC`,
            params
        );

        return result.rows;
    }

    /**
     * Lists the copies currently on loan to a vault member.
     * @param vaultId Vault id.
     * @param userId The member's user id.
     * @returns Every copy booked to them, most recent first.
     */
    public async listForMember(vaultId: number, userId: number): Promise<MyLoan[]> {
        const result = await this.db.query(
            `SELECT bs.id        AS "stockId",
                    bs.code      AS "stockCode",
                    bs.loaned_at AS "loanedAt",
                    b.id         AS "bookId",
                    b.name       AS "bookName",
                    b.image_url  AS "imageUrl"
               FROM book_stocks bs
                    JOIN books b ON b.id = bs.book_id AND b.vault_id = bs.vault_id
              WHERE bs.vault_id = $1
                AND bs.status = 2
                AND bs.member_user_id = $2
              ORDER BY bs.loaned_at DESC NULLS LAST, bs.id DESC`,
            [vaultId, userId]
        );
        return result.rows;
    }

    /**
     * Lists a vault member's whole loan history (returned and still open).
     * @param vaultId Vault id.
     * @param userId The member's user id.
     * @returns Every loan to them, most recent first.
     */
    public async historyForMember(vaultId: number, userId: number): Promise<MyLoanHistoryRow[]> {
        const result = await this.db.query(
            `SELECT book_id     AS "bookId",
                    book_name   AS "bookName",
                    stock_code  AS "stockCode",
                    loaned_at   AS "loanedAt",
                    returned_at AS "returnedAt"
               FROM loan_history
              WHERE vault_id = $1
                AND member_user_id = $2
              ORDER BY loaned_at DESC`,
            [vaultId, userId]
        );
        return result.rows;
    }
}
