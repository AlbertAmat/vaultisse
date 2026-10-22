/**
 * An author as referenced from a book (id + display name only).
 *
 * @example
 * const a: IBookAuthor = { id: 4, name: "J.R.R. Tolkien" };
 */
export default interface IBookAuthor {
    /** Author id. */
    id: number;
    /** Author display name. */
    name: string;
}
