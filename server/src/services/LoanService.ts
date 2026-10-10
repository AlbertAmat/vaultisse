import {Pool} from "pg";
import {LoanRepository} from "../repositories/LoanRepository";
import {Loan, LoanHistoryRow, LoanListFilter, LoanReportFilter, MyLoan, MyLoanHistoryRow} from "../types/loan";
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
     * @param vaultId Vault id.
     * @param filter Pagination and optional group/date-range filters.
     * @returns The total matching row count, the page size, and this page's rows.
     */
    public async listLoans(vaultId: number, filter: LoanListFilter): Promise<{total: number; limit: number; loans: Loan[]}> {
        const {total, loans} = await new LoanRepository(this.pool).list(vaultId, filter);
        return {total, limit: LoanRepository.MAX_ROWS, loans};
    }

    /**
     * Builds the loan-history export for the Loans view's Excel report.
     * @param vaultId Vault id.
     * @param filter Required date range (`dateFrom`/`dateTo`) and optional group/customer/member filters.
     * @returns Every matching loan-history row.
     */
    public async getLoanReport(
        vaultId: number,
        filter: {dateFrom: string | null; dateTo: string | null; groupId?: number | null; customerId?: number | null; memberUserId?: number | null}
    ): Promise<LoanHistoryRow[]> {
        if (!filter.dateFrom || !filter.dateTo) {
            throw new ValidationError("date_from and date_to are required");
        }
        return new LoanRepository(this.pool).report(vaultId, filter as LoanReportFilter);
    }

    /**
     * Lists the copies currently on loan to the calling vault member.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @returns Every copy booked to them.
     */
    public async listMyLoans(vaultId: number, userId: number): Promise<MyLoan[]> {
        return new LoanRepository(this.pool).listForMember(vaultId, userId);
    }

    /**
     * Lists the calling vault member's whole loan history.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @returns Every loan to them, most recent first.
     */
    public async listMyLoanHistory(vaultId: number, userId: number): Promise<MyLoanHistoryRow[]> {
        return new LoanRepository(this.pool).historyForMember(vaultId, userId);
    }
}
