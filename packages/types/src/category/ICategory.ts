/**
 * A book category/genre, as returned by `GET /category`.
 *
 * @example
 * const c: ICategory = { id: 3, name: "Fantasy" };
 */
export default interface ICategory {
    /** Category id. */
    id: number;
    /** Category name. */
    name: string;
}
