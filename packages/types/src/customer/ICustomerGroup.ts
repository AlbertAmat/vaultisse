/**
 * A customer group (e.g. a class or department), as returned by `GET /customer/group`.
 *
 * @example
 * const g: ICustomerGroup = { id: 1, name: "Class 4B", description: "", total_customers: 22 };
 */
export interface ICustomerGroup {
    /** Group id. */
    id: number;
    /** Group name. */
    name: string;
    /** Group description, optional. */
    description?: string;
    /** Number of customers currently in this group, optional (omitted on creation). */
    total_customers?: number;
}
