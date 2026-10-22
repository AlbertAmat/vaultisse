import IBookAuthor from "./IBookAuthor";
import {IBookBase} from "./IBookBase";
import {ReadingStatusEnum} from "./IReadingStatus";

/**
 * Book shape returned by the search list endpoint (`GET /book/search`) -
 * enough to render a result card, without the heavier detail fields
 * (description, stocks, ...) that live on `IBook`.
 *
 * @example
 * const item: IBookItem = {
 *   id: 12, name: "The Hobbit", image_url: null, isbn: "9780261102217",
 *   category_id: 3, language_code: "en", authors: [{ id: 4, name: "J.R.R. Tolkien" }]
 * };
 */
export default interface IBookItem extends IBookBase{
    /** Category id, or null if uncategorized. */
    category_id: number | null;
    /** 2-letter language code, or null if unset. */
    language_code: string | null;
    /** Authors attached to this book. */
    authors: IBookAuthor[];
    /** The user's personal reading progress for this book, or null if untracked. */
    reading_status: ReadingStatusEnum | null;
}
