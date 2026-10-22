import {BookStockStatusEnum} from "../../shared/types/book/IBookStock";

/**
 * Minimal identity fields for a single physical copy of a book.
 *
 * @example
 * const s: IBookStockBase = { id: 5, code: "a1b2c3d4e5", status: BookStockStatusEnum.AVAILABLE };
 */
export interface IBookStockBase {
    id: number;
    code: string;
    status: BookStockStatusEnum;
}
