import {Pool} from "pg";
import {LoanRepository} from "../repositories/LoanRepository";
import {Loan, LoanHistoryRow, LoanListFilter, LoanReportFilter} from "../types/loan";
import {ValidationError} from "../errors/DomainError";

/** Business rules for the Loans resource. Calls LoanRepository; throws DomainError subclasses for expected failures. */
export class LoanService {
    /**
     * @param pool Database connection pool, forwarded to a fresh LoanRepository on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Lists books currently on loan, paginated.
     * @param userId Owning user's id.
     * @param filter Pagination and optional group/date-range filters.
     * @returns The total matching row count, the page size, and this page's rows.
     */
    public async listLoans(userId: number, filter: LoanListFilter): Promise<{total: number; limit: number; loans: Loan[]}> {
        const {total, loans} = await new LoanRepository(this.pool).list(userId, filter);
        return {total, limit: LoanRepository.MAX_ROWS, loans};
    }

    /**
     * Builds the loan-history export for the Loans view's Excel report.
     * @param userId Owning user's id.
     * @param filter Required date range (`dateFrom`/`dateTo`) and optional group/customer filters.
     * @returns Every matching loan-history row.
     */
    public async getLoanReport(
        userId: number,
        filter: {dateFrom: string | null; dateTo: string | null; groupId?: number | null; customerId?: number | null}
    ): Promise<LoanHistoryRow[]> {
        if (!filter.dateFrom || !filter.dateTo) {
            throw new ValidationError("date_from and date_to are required");
        }
        return new LoanRepository(this.pool).report(userId, filter as LoanReportFilter);
    }
}
