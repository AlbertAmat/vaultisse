/**
 * Bookkeeping for `loan_history` - a persistent log of every loan and its
 * return, kept separate from `book_stocks` (which only tracks the *current*
 * loan and wipes `customer_id`/`loaned_at` on return). Every code path that
 * lends or returns a book_stocks copy (see BookService.ts and
 * CustomerService.ts) must call `recordLoan`/`recordReturn` alongside its
 * `book_stocks` update, so the Loans view's Excel report stays accurate.
 */
import {Pool, PoolClient} from "pg";

/** Data access for the `loan_history` ledger. See CustomerService/BookService for the lend/return flows built on top of this. */
export class LoanHistoryRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Logs a new loan: snapshots the book/customer/group names as they are
     * right now, so the report stays readable even if one of them is later
     * renamed or deleted.
     * @param vaultId Vault id.
     * @param stockCode The loaned copy's book_stocks.code.
     * @param customerId The customer the copy was loaned to.
     */
    public async recordLoan(vaultId: number, stockCode: string, customerId: number): Promise<void> {
        await this.db.query(
            `INSERT INTO loan_history (vault_id, book_id, book_name, stock_id, stock_code, customer_id, customer_name, group_id, group_name, loaned_at)
             SELECT bs.vault_id, bs.book_id, b.name, bs.id, bs.code, c.id, c.name, cg.id, cg.name, NOW()
             FROM book_stocks bs
                      JOIN books b ON b.id = bs.book_id AND b.vault_id = bs.vault_id
                      JOIN customers c ON c.id = $2 AND c.vault_id = bs.vault_id
                      LEFT JOIN customer_groups cg ON cg.id = c.group_id
             WHERE bs.code = $1
               AND bs.vault_id = $3`,
            [stockCode, customerId, vaultId]
        );
    }

    /**
     * Closes out the most recent open loan_history entry for a returned
     * copy. A no-op if there's no matching entry (e.g. the loan happened
     * before this table existed).
     * @param vaultId Vault id.
     * @param stockCode The returned copy's book_stocks.code.
     */
    public async recordReturn(vaultId: number, stockCode: string): Promise<void> {
        await this.db.query(
            `UPDATE loan_history
             SET returned_at = NOW()
             WHERE id = (
                 SELECT id
                 FROM loan_history
                 WHERE vault_id = $1
                   AND stock_code = $2
                   AND returned_at IS NULL
                 ORDER BY loaned_at DESC
                 LIMIT 1
             )`,
            [vaultId, stockCode]
        );
    }
}
