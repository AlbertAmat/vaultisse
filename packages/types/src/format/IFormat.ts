/**
 * A book format (e.g. "Paperback", "Hardcover"), from the global `formats` table.
 *
 * @example
 * const f: IFormat = { id: 1, name: "Paperback" };
 */
export interface IFormat {
    /** Format id. */
    id: number;
    /** Format display name. */
    name: string;
}
