/**
 * Minimal book identity fields shared by every book-related view model.
 *
 * @example
 * const b: IBookBase = { id: 12, name: "The Hobbit", image_url: null, isbn: "9780261102217" };
 */
export interface IBookBase {
    /** Book id. */
    id: number;
    /** Book title. */
    name: string;
    /** Cover image URL/data-URI, or null if none. */
    image_url: string | null;
    /** ISBN code, or null if none. */
    isbn: string | null;
}
