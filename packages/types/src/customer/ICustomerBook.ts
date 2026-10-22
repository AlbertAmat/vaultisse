import {IBookBase} from "../book/IBookBase";

/**
 * A book currently on loan to a customer, as returned by
 * `GET /customer/:id/books`.
 *
 * @example
 * const b: ICustomerBook = { id: 12, name: "The Hobbit", image_url: null, isbn: "...", code: "a1b2c3d4e5" };
 */
export interface ICustomerBook extends IBookBase{
    /** Book stock code. */
    code: string;
}
