import {BookStockStatusEnum} from "./IBookStock";

/**
 * Minimal identity fields for a physical book copy.
 *
 * @example
 * const s: IBookStockBase = { id: 5, code: "a1b2c3d4e5", status: BookStockStatusEnum.AVAILABLE };
 */
export interface IBookStockBase {
    /** Stock id. */
    id: number;
    /** Unique stock code (scannable/typeable). */
    code: string;
    /** Current lifecycle status. */
    status:BookStockStatusEnum;
}
