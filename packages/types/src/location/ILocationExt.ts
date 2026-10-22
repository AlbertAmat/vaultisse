import ILocation from "./ILocation";

/**
 * `ILocation` extended with a `total_books` count, used on the locations
 * list view.
 */
export default interface ILocationExt extends ILocation{
    /** Total number of book stocks at this location. */
    total_books: number;
}
