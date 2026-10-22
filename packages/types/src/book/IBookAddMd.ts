import {IBookBase} from "./IBookBase";
import {IBookStockBase} from "./IBookStockBase";

/**
 * Response shape from `GET /book/:bookCode/add/md` - the book plus the
 * single stock matched by a scanned/typed stock code, used by the
 * "add book to customer/location" flow.
 *
 * @example
 * const md: IBookAddMd = {
 *   id: 12, name: "The Hobbit", image_url: null, isbn: "9780261102217",
 *   stocks: [{ id: 5, code: "a1b2c3d4e5", status: 0 }]
 * };
 */
export interface IBookAddMd extends IBookBase {
    /** The single matched stock (always exactly one entry). */
    stocks: IBookStockBase[];
}
