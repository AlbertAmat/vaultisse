/** A copy that can be lent right now (`GET /loans/available`). */
export interface IAvailableStock {
    /** book_stocks.code of the copy. */
    code: string;
    /** Book title. */
    bookName: string;
    /** Cover image URL/data-URI, or null if none. */
    imageUrl: string | null;
    /** Where the copy is shelved, or null. */
    locationName: string | null;
}
