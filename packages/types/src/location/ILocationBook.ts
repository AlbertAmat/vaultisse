import {BookStockStatusEnum} from "../book/IBookStock";

/**
 * A book stock currently stored at a location, as returned by
 * `GET /location/:id/books`.
 *
 * @example
 * const b: ILocationBook = {
 *   id: 5, book_id: 12, code: "a1b2c3d4e5", name: "The Hobbit",
 *   image_url: null, status: BookStockStatusEnum.AVAILABLE
 * };
 */
export default interface ILocationBook {
    /** Stock id. */
    id:number;
    /** Id of the book this stock is a copy of. */
    book_id: number;
    /** Unique stock code (scannable/typeable). */
    code: string;
    /** Book title. */
    name: string;
    /** Cover image URL/data-URI, or null if none. */
    image_url: string | null;
    /** Current lifecycle status. */
    status: BookStockStatusEnum
}
