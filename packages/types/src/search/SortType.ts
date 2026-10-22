/**
 * Sort order sent as the `sort` query param to `GET /book/search`.
 *
 * @example
 * // book/search?sort=DATE_NEWEST
 * SearchService.search({ sort: SortType.DATE_NEWEST });
 */
export enum SortType {
    /** Book name, A-Z (default). */
    NAME_ASC = "NAME_ASC",
    /** Book name, Z-A. */
    NAME_DESC = "NAME_DESC",
    /** Most recently added first. */
    DATE_NEWEST = "DATE_NEWEST",
    /** Least recently added first. */
    DATE_OLDEST = "DATE_OLDEST"
}
