import {IBookStockBase} from "@/types/book/IBookStockBase";

/**
 * A single physical copy of a book, with its resolved location and (if
 * loaned out) customer, as returned by the book detail / stock endpoints.
 *
 * @example
 * const stock: IBookStock = {
 *   id: 5, code: "a1b2c3d4e5", status: BookStockStatusEnum.AVAILABLE,
 *   location_id: 2, location_name: "Main shelf", customer_id: 0, customer_name: ""
 * };
 */
export interface IBookStock extends IBookStockBase{
    /** Stock id. */
    id: number;
    /** Unique stock code (scannable/typeable). */
    code: string;
    /** Current lifecycle status. */
    status:BookStockStatusEnum;
    /** Id of the location this stock is stored at. */
    location_id: number;
    /** Name of the location this stock is stored at. */
    location_name: string;
    /** Id of the customer this stock is loaned/booked to. */
    customer_id: number | null;
    /** Id of the vault member this stock is loaned/booked to (instead of a customer), or null. */
    member_user_id: number | null;
    /** Name of the customer or vault member this stock is loaned/booked to. */
    customer_name: string;
}

/** Lifecycle states for a physical book copy (mirrors the server's `BookStockStatusEnum`). */
export enum BookStockStatusEnum {
    /** On a shelf, not lent out or damaged. */
    AVAILABLE = 0,
    /** Withdrawn from circulation. */
    NOT_AVAILABLE = 1,
    /** Currently lent/checked out to a customer. */
    BOOKED = 2,
    /** Marked as damaged. */
    DAMAGE = 3
}
