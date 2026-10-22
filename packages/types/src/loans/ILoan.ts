/**
 * Response shape for `GET /loans` - a page of books currently on loan, for
 * the Loans management view.
 *
 * @example
 * const r: ILoansResponse = {
 *   total: 1, limit: 50,
 *   loans: [{ stockId: 5, stockCode: "a1b2c3d4e5", bookId: 12, bookName: "The Hobbit",
 *             imageUrl: null, customerId: 4, customerName: "Maria Puig",
 *             groupId: 2, groupName: "Class 4B", loanedAt: "2026-08-30T05:39:03.026Z" }]
 * };
 */
export default interface ILoansResponse {
    /** Total number of loans matching the current filters, across all pages. */
    total: number;
    /** Number of results per page. */
    limit: number;
    /** This page's loans, newest first. */
    loans: ILoan[];
}

/** One book currently on loan, with who has it and their group. */
export interface ILoan {
    /** book_stocks.id of the loaned copy. */
    stockId: number;
    /** book_stocks.code of the loaned copy. */
    stockCode: string;
    /** Book id. */
    bookId: number;
    /** Book title. */
    bookName: string;
    /** Cover image URL/data-URI, or null if none. */
    imageUrl: string | null;
    /** Customer id, or null when loaned to a vault member. */
    customerId: number | null;
    /** Vault member's user id, or null when loaned to a customer. */
    memberUserId: number | null;
    /** Customer or vault member name. */
    customerName: string;
    /** Customer's group id, or null if ungrouped. */
    groupId: number | null;
    /** Customer's group name, or null if ungrouped. */
    groupName: string | null;
    /** When this copy was loaned out, ISO string, or null if unknown (loaned before this field existed). */
    loanedAt: string | null;
}
