/**
 * Response shape for `GET /book/counters` - lightweight totals powering the
 * "Library" section of the left nav and its quick filters.
 */
export interface IBookCounters {
    /** Total number of books in the user's library. */
    total: number;
    /** Books added in the last 30 days. */
    recent: number;
    /** Books with at least one stock currently on loan. */
    onLoan: number;
    /** Books with zero stock entries. */
    noStock: number;
    /** Books on the user's "want to read" shelf. */
    wantToRead: number;
    /** Books on the user's "currently reading" shelf. */
    currentlyReading: number;
}
