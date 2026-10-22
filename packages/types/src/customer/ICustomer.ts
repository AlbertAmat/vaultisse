/**
 * A customer, as returned in list contexts (`GET /customer`).
 *
 * @example
 * const c: ICustomer = { id: 7, name: "Jane Doe", group_id: 1, group_name: "Class 4B" };
 */
export default interface ICustomer {
    /** Customer id. */
    id: number;
    /** Customer display name. */
    name: string;
    /** Id of the group this customer belongs to, or null if ungrouped. */
    group_id: number | null;
    /** Name of the group this customer belongs to, or null if ungrouped. */
    group_name: string | null;
}

/**
 * `ICustomer` extended with the extra fields shown on the customers table -
 * the count of books currently on loan.
 */
export interface ICustomerDetail extends ICustomer{
    /** Number of books currently on loan to this customer. */
    total_books: number;
}
