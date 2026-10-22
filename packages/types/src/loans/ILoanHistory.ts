/**
 * One row of the Loans view's Excel report - a single loan (returned or
 * not), as returned by `GET /loans/report` (see server/src/routes/LoansRoute.ts).
 *
 * @example
 * const row: ILoanHistoryEntry = {
 *   bookName: "The Hobbit", stockCode: "a1b2c3d4e5",
 *   customerName: "Maria Puig", groupName: "Class 4B",
 *   loanedAt: "2026-08-01T05:39:03.026Z", returnedAt: null
 * };
 */
export default interface ILoanHistoryEntry {
    /** Book title, as it was when the loan was made. */
    bookName: string;
    /** book_stocks.code of the loaned copy. */
    stockCode: string;
    /** Borrower's name, as it was when the loan was made. */
    customerName: string;
    /** Borrower's group name at loan time, or null if they were ungrouped. */
    groupName: string | null;
    /** When the copy was loaned out, ISO string. */
    loanedAt: string;
    /** When the copy was returned, ISO string, or null if still on loan. */
    returnedAt: string | null;
}
