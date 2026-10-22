/**
 * A copy currently on loan to the logged-in vault member, as returned by
 * `GET /loans/mine`.
 *
 * @example
 * const l: IMyLoan = { stockId: 10, stockCode: "a1b2c3d4e5", loanedAt: "2026-01-05T10:00:00.000Z",
 *   bookId: 3, bookName: "The Hobbit", imageUrl: null };
 */
export interface IMyLoan {
    /** Stock id. */
    stockId: number;
    /** Stock code of the borrowed copy. */
    stockCode: string;
    /** When the copy was loaned out, ISO string, or null if unknown. */
    loanedAt: string | null;
    /** Book id. */
    bookId: number;
    /** Book title. */
    bookName: string;
    /** Cover image URL/data-URI, or null if none. */
    imageUrl: string | null;
}

/**
 * One loan to the logged-in vault member, as returned by `GET /loans/mine/history`.
 */
export interface IMyLoanHistoryRow {
    /** Book id, or null if the book has since been deleted. */
    bookId: number | null;
    /** Book title as it was when loaned. */
    bookName: string;
    /** Stock code of the borrowed copy. */
    stockCode: string;
    /** When the copy was loaned out, ISO string. */
    loanedAt: string;
    /** When it was returned, ISO string, or null if still on loan. */
    returnedAt: string | null;
}

/** Everything the "My loans" view shows. */
export interface IMyLoansData {
    /** Copies currently on loan to the caller. */
    loans: IMyLoan[];
    /** The caller's whole loan history. */
    history: IMyLoanHistoryRow[];
}
