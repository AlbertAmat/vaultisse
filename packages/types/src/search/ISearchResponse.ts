import IBookItem from "../book/IBookItem";

/**
 * Response shape for `GET /book/search` - a page of matching books plus
 * pagination info (`total` results overall, `limit` per page).
 */
export interface ISearchResponse {
    /** Total number of matching books across all pages. */
    total: number;
    /** Number of results per page. */
    limit: number;
    /** Books in this page of results. */
    books: IBookItem[];
}
