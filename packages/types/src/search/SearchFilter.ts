/**
 * Extra filters sent as the `filters` query param (comma-separated) to
 * `GET /book/search`, narrowing results by stock availability, loan status
 * or recency.
 *
 * @example
 * // book/search?filters=HAS_STOCK
 * SearchService.search({ filters: [SearchFilter.HAS_STOCK] });
 */
export enum SearchFilter {
    /** Books with zero stock entries. */
    NO_STOCK="NO_STOCK",
    /** Books with at least one stock entry. */
    HAS_STOCK="HAS_STOCK",
    /** Books with at least one stock currently on loan. */
    ON_LOAN="ON_LOAN",
    /** Books added in the last 30 days. */
    RECENT="RECENT",
    /** Books on the user's "want to read" shelf (`reading_status` = WANT_TO_READ). */
    WANT_TO_READ="WANT_TO_READ",
    /** Books on the user's "currently reading" shelf (`reading_status` = CURRENTLY_READING). */
    CURRENTLY_READING="CURRENTLY_READING"
}
