/**
 * A physical storage location (shelf, room, warehouse, ...), as returned
 * by `GET /location`.
 *
 * @example
 * const l: ILocation = { id: 2, name: "Main shelf", description: "Front room", default: false };
 */
export default interface ILocation {
    /** Location id. */
    id: number;
    /** Location name. */
    name: string;
    /** Location description, or null if unset. */
    description: string | null;
    /** Whether this is the user's default location, pre-filled when adding a new book stock. */
    default: boolean;
}
